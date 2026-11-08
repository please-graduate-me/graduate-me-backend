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
      await tx.query(`UPDATE "Job" SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
        "leaseToken" = NULL, "heartbeatAt" = NULL, "availableAt" = now() - interval '1 second', "updatedAt" = now(),
        "errorCode" = 'WORKER_INTERRUPTED', "errorMessage" = '처리 작업이 중단되었습니다. 다시 시도해 주세요.'
        WHERE status IN ('preparing','transcribing') AND "heartbeatAt" < now() - interval '90 seconds'`);

      const rows: ClaimedJob[] =
        await tx.query(`SELECT j.*, v."youtubeId" FROM "Job" j JOIN "Video" v ON v.id = j."videoId"
        WHERE j.status = 'queued' AND j."availableAt" <= now()
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
          statuses: ['preparing', 'transcribing'],
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
    event: Extract<ProcessorEvent, { type: 'complete' }>
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
        leaseToken: null,
        heartbeatAt: null,
        errorCode: null,
        errorMessage: null,
      });

      return true;
    });
  }

  async fail(
    job: ClaimedJob,
    code: string,
    message: string,
    retryable: boolean
  ) {
    await this.db
      .createQueryBuilder()
      .update(Job)
      .set({
        status: retryable && job.attempts < 3 ? 'queued' : 'failed',
        availableAt: new Date(Date.now() + 15 * 2 ** (job.attempts - 1) * 1000),
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
  }
}
