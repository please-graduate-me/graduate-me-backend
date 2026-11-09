import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Job } from '../database/entities/Job.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import type { ClaimedJob, ProcessorEvent } from './contracts.js';

/** PostgreSQL 작업 소유권과 결과 저장을 API 프로세스와 분리해 관리한다. */
@Injectable()
export class QueueService {
  constructor(private readonly db: DataSource) {}

  async claim(): Promise<ClaimedJob | null> {
    return this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE "Job" SET status = 'failed', "leaseToken" = NULL, "heartbeatAt" = NULL, "updatedAt" = now(), "errorCode" = 'RETRY_DISABLED', "errorMessage" = '이전 분석 요청을 다시 실행하지 않습니다.' WHERE status = 'queued' AND attempts > 0`
      );

      await tx.query(`UPDATE "Video" v SET "translationStatus" = CASE WHEN v."translationStatus" IN ('pending','processing') THEN 'failed' ELSE v."translationStatus" END,
        "blankStatus" = CASE WHEN v."blankStatus" IN ('pending','processing') THEN 'failed' ELSE v."blankStatus" END, "processingError" = '후속 자료 준비가 중단되었습니다. 자동 재시도하지 않습니다.'
        FROM "Job" j WHERE j."videoId" = v.id AND j.status = 'ready' AND j."leaseToken" IS NOT NULL AND j."heartbeatAt" < now() - interval '90 seconds'`);

      await tx.query(`UPDATE "Job" SET status = CASE WHEN status = 'ready' THEN 'ready' ELSE 'failed' END,
        "leaseToken" = NULL, "heartbeatAt" = NULL, "updatedAt" = now(),
        "errorCode" = 'WORKER_INTERRUPTED', "errorMessage" = '처리 작업이 중단되었습니다. 자동 재시도하지 않습니다.'
        WHERE status IN ('preparing','transcribing','ready') AND "leaseToken" IS NOT NULL AND "heartbeatAt" < now() - interval '90 seconds'`);

      await tx.query(`UPDATE "Video" v SET "translationStatus" = CASE WHEN v."translationStatus" IN ('pending','processing') THEN 'failed' ELSE v."translationStatus" END,
        "blankStatus" = CASE WHEN v."blankStatus" IN ('pending','processing') THEN 'failed' ELSE v."blankStatus" END, "processingError" = j."errorMessage"
        FROM "Job" j WHERE j."videoId" = v.id AND j.status = 'failed' AND (v."translationStatus" IN ('pending','processing') OR v."blankStatus" IN ('pending','processing'))`);

      const rows: ClaimedJob[] =
        await tx.query(`SELECT j.*, v."youtubeId", v.language, v."ownerId" FROM "Job" j JOIN "Video" v ON v.id = j."videoId"
        WHERE j.status = 'queued' AND j.attempts = 0 AND j."availableAt" <= now()
        ORDER BY j."createdAt" FOR UPDATE OF j SKIP LOCKED LIMIT 1`);

      const job = rows[0];

      if (!job) return null;
      job.leaseToken = randomUUID();
      job.attempts += 1;

      await tx.update(Job, job.id, {
        status: 'preparing',
        attempts: job.attempts,
        leaseToken: job.leaseToken,
        heartbeatAt: new Date(),
        errorCode: null,
        errorMessage: null,
      });

      return job;
    });
  }

  async heartbeat(job: ClaimedJob) {
    const result = await this.db
      .createQueryBuilder()
      .update(Job)
      .set({
        heartbeatAt: () => 'now()',
      })
      .where(
        'id = :id AND "leaseToken" = :token AND status IN (:...statuses)',
        {
          id: job.id,
          token: job.leaseToken,
          statuses: ['preparing', 'transcribing', 'ready'],
        }
      )
      .execute();

    return result.affected === 1;
  }

  private async owned(tx: EntityManager, job: ClaimedJob) {
    const row = await tx.findOne(Job, {
      where: { id: job.id, leaseToken: job.leaseToken },
      lock: { mode: 'pessimistic_write' },
    });

    return row && ['preparing', 'transcribing'].includes(row.status)
      ? row
      : null;
  }

  async transcribing(
    job: ClaimedJob,
    event: Extract<ProcessorEvent, { type: 'transcribing' }>
  ) {
    return this.db.transaction(async (tx) => {
      const owned = await this.owned(tx, job);

      if (!owned || owned.status !== 'preparing')
        throw new Error('작업 소유권이 만료되었습니다.');
      await tx.update(Job, job.id, { status: 'transcribing' });

      await tx.update(Video, job.videoId, {
        title: event.title,
        duration: event.duration,
        category: event.category,
        youtubeCategoryId: event.youtubeCategoryId,
      });
    });
  }

  async complete(
    job: ClaimedJob,
    event: Extract<ProcessorEvent, { type: 'complete' }>,
    keepLease = false
  ) {
    return this.db.transaction(async (tx) => {
      const owned = await this.owned(tx, job);

      if (!owned || owned.status !== 'transcribing') return false;

      await tx.insert(
        Segment,
        event.segments.map((segment) => ({ ...segment, videoId: job.videoId }))
      );

      await tx.update(Job, job.id, {
        status: 'ready',
        leaseToken: keepLease ? job.leaseToken : null,
        heartbeatAt: keepLease ? new Date() : null,
        errorCode: null,
        errorMessage: null,
      });

      return true;
    });
  }

  async fail(job: ClaimedJob, code: string, message: string) {
    const result = await this.db
      .createQueryBuilder()
      .update(Job)
      .set({
        status: () =>
          "CASE WHEN status = 'ready' THEN 'ready' ELSE 'failed' END",
        leaseToken: null,
        heartbeatAt: null,
        errorCode: code,
        errorMessage: message,
      })
      .where('id = :id AND "leaseToken" = :token', {
        id: job.id,
        token: job.leaseToken,
      })
      .execute();

    if (result.affected)
      await this.db
        .createQueryBuilder()
        .update(Video)
        .set({
          translationStatus: () =>
            `CASE WHEN "translationStatus" IN ('pending','processing') THEN 'failed' ELSE "translationStatus" END`,
          blankStatus: () =>
            `CASE WHEN "blankStatus" IN ('pending','processing') THEN 'failed' ELSE "blankStatus" END`,
          processingError: message,
        })
        .where('id = :videoId', { videoId: job.videoId })
        .execute();
  }
  async release(job: ClaimedJob) {
    await this.db.manager.update(
      Job,
      { id: job.id, leaseToken: job.leaseToken, status: 'ready' },
      { leaseToken: null, heartbeatAt: null }
    );
  }
}
