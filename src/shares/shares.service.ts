import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { HttpError } from '../common/http-error.js';

@Injectable()
/** 공유 자료와 방문 집계를 개인 학습 기록에서 분리한다. */
export class SharesService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  private async active(tx: Prisma.TransactionClient, id: string) {
    const link = await tx.shareLink.findFirst({
      where: {
        id,
        revokedAt: null,
        video: {
          job: { is: { status: 'ready' } },
          segments: { some: { excluded: false } },
        },
        OR: [{ segmentId: null }, { segment: { is: { excluded: false } } }],
      },
      include: { video: true, segment: true },
    });
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
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const progress = await tx.progress.findUnique({
        where: { userId_videoId: { userId, videoId: input.videoId } },
      });
      if (!progress)
        throw new HttpError(404, '내 학습에 등록한 영상만 공유할 수 있습니다.');
      const video = await tx.video.findFirst({
        where: {
          id: input.videoId,
          job: { is: { status: 'ready' } },
          segments: { some: { excluded: false } },
        },
      });
      if (!video)
        throw new HttpError(
          409,
          '학습 준비가 완료된 영상만 공유할 수 있습니다.'
        );
      if (
        input.segmentId &&
        !(await tx.segment.findFirst({
          where: { id: input.segmentId, videoId: video.id, excluded: false },
        }))
      )
        throw new HttpError(404, '공유할 구절을 찾을 수 없습니다.');
      const existing = await tx.shareLink.findUnique({
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
        await tx.shareLink.create({
          data: {
            id: input.requestId,
            creatorId: userId,
            videoId: video.id,
            segmentId: input.segmentId,
          },
        });
      return { id: input.requestId, path: `/share/${input.requestId}` };
    });
  }
  async get(id: string) {
    const { video, segment } = await this.active(this.db, id);
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
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "ShareLink" WHERE id = ${id} FOR SHARE`;
      await this.active(tx, id);
      await tx.shareVisit.createMany({
        data: [{ shareId: id, visitId }],
        skipDuplicates: true,
      });
      return { ok: true };
    });
  }
  async start(userId: string, id: string, visitId: string) {
    return this.db.$transaction(async (tx) => {
      // 공유 중지와 학습 시작이 동시에 처리되지 않게 한다.
      await tx.$executeRaw`SELECT id FROM "ShareLink" WHERE id = ${id} FOR UPDATE`;
      const link = await this.active(tx, id);
      const segments = await tx.segment.findMany({
        where: { videoId: link.videoId, excluded: false },
        orderBy: { index: 'asc' },
        select: { id: true },
      });
      const index = link.segmentId
        ? segments.findIndex((segment) => segment.id === link.segmentId)
        : 0;
      if (index < 0)
        throw new HttpError(404, '학습할 구절을 찾을 수 없습니다.');
      await tx.progress.upsert({
        where: { userId_videoId: { userId, videoId: link.videoId } },
        create: { userId, videoId: link.videoId, currentIndex: index },
        update: {
          archivedAt: null,
          ...(link.segmentId ? { currentIndex: index } : {}),
        },
      });
      await tx.shareVisit.createMany({
        data: [{ shareId: id, visitId }],
        skipDuplicates: true,
      });
      await tx.shareStart.createMany({
        data: [{ shareId: id, userId }],
        skipDuplicates: true,
      });
      return { videoId: link.videoId };
    });
  }
}
