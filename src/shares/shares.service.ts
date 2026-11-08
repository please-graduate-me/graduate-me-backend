import { DataSource, type EntityManager } from 'typeorm';
import { Progress } from '../database/entities/Progress.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { ShareLink } from '../database/entities/ShareLink.entity.js';
import { ShareVisit } from '../database/entities/ShareVisit.entity.js';
import { ShareStart } from '../database/entities/ShareStart.entity.js';
import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../common/http-error.js';

@Injectable()
/** 공유 자료와 방문 집계를 개인 학습 기록에서 분리한다. */
export class SharesService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  private async active(tx: EntityManager, id: string) {
    const link = await tx
      .getRepository(ShareLink)
      .createQueryBuilder('link')
      .innerJoinAndSelect('link.video', 'video')
      .innerJoin('video.job', 'job', 'job.status = :status', {
        status: 'ready',
      })
      .leftJoinAndSelect('link.segment', 'segment')
      .where('link.id = :id AND link.revokedAt IS NULL', { id })
      .andWhere(
        'EXISTS (SELECT 1 FROM "Segment" s WHERE s."videoId" = video.id)'
      )
      .getOne();

    if (!link)
      throw new HttpError(
        404,
        '공유 링크가 없거나 더 이상 사용할 수 없습니다.'
      );

    return link;
  }
  async create(
    userId: string,
    input: { requestId: string; videoId: string; segmentId?: string }
  ) {
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        input.requestId,
      ]);

      const progress = await tx.findOne(Progress, {
        where: { userId, videoId: input.videoId },
      });

      if (!progress)
        throw new HttpError(404, '내 학습에 등록한 영상만 공유할 수 있습니다.');

      const video = await tx
        .getRepository(Video)
        .createQueryBuilder('video')
        .innerJoin('video.job', 'job', 'job.status = :status', {
          status: 'ready',
        })
        .where('video.id = :id', { id: input.videoId })
        .andWhere(
          'EXISTS (SELECT 1 FROM "Segment" s WHERE s."videoId" = video.id)'
        )
        .getOne();

      if (!video)
        throw new HttpError(
          409,
          '학습 준비가 완료된 영상만 공유할 수 있습니다.'
        );
      if (
        input.segmentId &&
        !(await tx.findOne(Segment, {
          where: { id: input.segmentId, videoId: video.id },
        }))
      )
        throw new HttpError(404, '공유할 구절을 찾을 수 없습니다.');

      const existing = await tx.findOne(ShareLink, {
        where: { id: input.requestId },
      });

      if (
        existing &&
        (existing.creatorId !== userId ||
          existing.videoId !== video.id ||
          existing.segmentId !== (input.segmentId ?? null))
      )
        throw new HttpError(409, '이미 사용된 공유 요청입니다.');
      if (existing?.revokedAt)
        throw new HttpError(409, '중지된 공유 링크입니다.');
      if (!existing)
        await tx.insert(ShareLink, {
          id: input.requestId,
          creatorId: userId,
          videoId: video.id,
          segmentId: input.segmentId,
        });

      return { id: input.requestId, path: `/share/${input.requestId}` };
    });
  }
  async get(id: string) {
    const { video, segment } = await this.active(this.db.manager, id);

    return {
      id,
      video: {
        id: video.id,
        youtubeId: video.youtubeId,
        title: video.title,
        duration: video.duration,
        category: video.category,
      },
      segment: segment
        ? { id: segment.id, start: segment.start, end: segment.end }
        : null,
    };
  }
  async visit(id: string, visitId: string) {
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM "ShareLink" WHERE id = $1 FOR SHARE', [
        id,
      ]);

      await this.active(tx, id);

      await tx
        .createQueryBuilder()
        .insert()
        .into(ShareVisit)
        .values([{ shareId: id, visitId }])
        .orIgnore()
        .execute();

      return { ok: true };
    });
  }
  async start(userId: string, id: string, visitId: string) {
    return this.db.transaction(async (tx) => {
      // 공유 중지와 학습 시작이 동시에 처리되지 않게 한다.
      await tx.query('SELECT id FROM "ShareLink" WHERE id = $1 FOR UPDATE', [
        id,
      ]);

      const link = await this.active(tx, id);

      const segments = await tx.find(Segment, {
        where: { videoId: link.videoId },
        select: { id: true },
        order: { index: 'asc' },
      });

      const index = link.segmentId
        ? segments.findIndex((segment) => segment.id === link.segmentId)
        : 0;

      if (index < 0)
        throw new HttpError(404, '학습할 구절을 찾을 수 없습니다.');

      await tx
        .createQueryBuilder()
        .insert()
        .into(Progress)
        .values({ userId, videoId: link.videoId, currentIndex: index })
        .orIgnore()
        .execute();

      await tx.update(
        Progress,
        { userId, videoId: link.videoId },
        {
          archivedAt: null,
          ...(link.segmentId ? { currentIndex: index } : {}),
        }
      );

      await tx
        .createQueryBuilder()
        .insert()
        .into(ShareVisit)
        .values([{ shareId: id, visitId }])
        .orIgnore()
        .execute();

      await tx
        .createQueryBuilder()
        .insert()
        .into(ShareStart)
        .values([{ shareId: id, userId }])
        .orIgnore()
        .execute();

      return { videoId: link.videoId };
    });
  }
}
