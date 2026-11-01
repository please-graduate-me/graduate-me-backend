import { blankIndices, gradeAnswer } from './grading.js';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  recommendations,
  type Mode,
  type LearningAction,
} from '@graduate-me/shared';
import { PrismaService } from '../database/prisma.service.js';
import { HttpError } from '../common/http-error.js';
import { parseYouTubeUrl } from './youtube.js';
@Injectable()
/** 영상과 계정별 진도 변경을 트랜잭션 경계 안에서 처리한다. */
export class VideosService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async list(userId: string) {
    const progress = await this.db.progress.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        video: {
          include: {
            job: true,
            _count: { select: { segments: { where: { excluded: false } } } },
          },
        },
      },
    });
    return progress.map((p) => ({
      videoId: p.videoId,
      title: p.video.title,
      currentIndex: p.currentIndex,
      count: p.video._count.segments,
      status: p.video.job?.status ?? 'queued',
      updatedAt: p.updatedAt,
    }));
  }
  async registerVideo(userId: string, url: string) {
    let youtubeId: string;
    try {
      youtubeId = parseYouTubeUrl(url);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    return this.db.$transaction(async (tx) => {
      // 같은 영상의 동시 등록이 작업을 중복 생성하지 않도록 직렬화한다.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${youtubeId}))`;
      const video = await tx.video.upsert({
        where: { youtubeId },
        update: {},
        create: {
          youtubeId,
          title:
            recommendations.find((item) => item.youtubeId === youtubeId)
              ?.title ?? '영상 정보를 확인하고 있어요',
        },
      });
      const job = await tx.job.findUnique({ where: { videoId: video.id } });
      if (!job && !(process.env.GROQ_API_KEY || process.env.QRUQ_WHISPER))
        throw new HttpError(503, '음성 인식 API 키가 설정되지 않았습니다.');
      if (!job) await tx.job.create({ data: { videoId: video.id } });
      await tx.progress.upsert({
        where: { userId_videoId: { userId, videoId: video.id } },
        update: {},
        create: { userId, videoId: video.id },
      });
      return { videoId: video.id };
    });
  }
  async retryVideo(userId: string, videoId: string) {
    const progress = await this.db.progress.findUnique({
      where: { userId_videoId: { userId, videoId } },
    });
    if (!progress) throw new HttpError(404, '학습 영상을 찾을 수 없습니다.');
    if (!(process.env.GROQ_API_KEY || process.env.QRUQ_WHISPER))
      throw new HttpError(503, '음성 인식 API 키가 설정되지 않았습니다.');
    const updated = await this.db.job.updateMany({
      where: { videoId, status: 'failed' },
      data: {
        status: 'queued',
        attempts: 0,
        availableAt: new Date(),
        heartbeatAt: null,
        leaseToken: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (!updated.count)
      throw new HttpError(409, '실패한 작업만 다시 시도할 수 있습니다.');
    return { ok: true };
  }
  async getLesson(userId: string, videoId: string) {
    const progress = await this.db.progress.findUnique({
      where: { userId_videoId: { userId, videoId } },
      include: {
        states: true,
        video: {
          include: {
            job: true,
            segments: { where: { excluded: false }, orderBy: { index: 'asc' } },
          },
        },
      },
    });
    if (!progress) throw new HttpError(404, '학습 영상을 찾을 수 없습니다.');
    const { video, states } = progress;
    return {
      video: {
        id: video.id,
        youtubeId: video.youtubeId,
        title: video.title,
        duration: video.duration,
      },
      job: video.job
        ? {
            status: video.job.status,
            attempts: video.job.attempts,
            errorMessage: video.job.errorMessage,
          }
        : null,
      progress: { currentIndex: progress.currentIndex, mode: progress.mode },
      segments: video.segments.map((segment, index) => ({
        ...segment,
        index,
        blanks: blankIndices(segment.text),
      })),
      states: states
        .filter((state) =>
          video.segments.some((segment) => segment.id === state.segmentId)
        )
        .map((state) => ({
          segmentId: state.segmentId,
          mode: state.mode,
          draft: state.draft,
          status: state.status,
          revealed: state.revealed,
        })),
    };
  }
  async applyAction(userId: string, videoId: string, input: LearningAction) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Video" WHERE id = ${videoId} FOR SHARE`;
      const progress = await tx.progress.findUnique({
        where: { userId_videoId: { userId, videoId } },
      });
      if (!progress) throw new HttpError(404, '학습 영상을 찾을 수 없습니다.');
      // 동일 계정의 저장과 제출이 오래된 진도를 덮어쓰지 않게 한다.
      await tx.$executeRaw`SELECT id FROM "Progress" WHERE id = ${progress.id} FOR UPDATE`;
      const job = await tx.job.findUnique({ where: { videoId } });
      if (job?.status !== 'ready')
        throw new HttpError(409, '영상 처리가 아직 완료되지 않았습니다.');
      const activeSegments = await tx.segment.findMany({
        where: { videoId, excluded: false },
        orderBy: { index: 'asc' },
        select: { id: true },
      });
      const count = activeSegments.length;
      if (input.action === 'navigate') {
        if (input.index > count)
          throw new HttpError(400, '구절 범위를 벗어났습니다.');
        await tx.progress.update({
          where: { id: progress.id },
          data: { currentIndex: input.index, mode: input.mode },
        });
        return { ok: true };
      }
      const segment = await tx.segment.findFirst({
        where: { id: input.segmentId, videoId, excluded: false },
      });
      if (!segment)
        throw new HttpError(
          404,
          '이 구절이 없거나 학습 목록에서 제외되었습니다. 새로고침해 주세요.'
        );
      const activeIndex = activeSegments.findIndex(
        (item) => item.id === segment.id
      );
      if (
        'answer' in input &&
        (input.mode === 'full'
          ? typeof input.answer !== 'string'
          : !Array.isArray(input.answer) ||
            input.answer.length !== blankIndices(segment.text).length)
      ) {
        throw new HttpError(400, '학습 모드에 맞는 답안을 입력해 주세요.');
      }
      const key = {
        progressId: progress.id,
        segmentId: segment.id,
        mode: input.mode,
      };
      const state = await tx.segmentState.upsert({
        where: { progressId_segmentId_mode: key },
        update: {},
        create: { ...key, draft: input.mode === 'full' ? '' : [] },
      });
      if (input.action === 'draft') {
        await tx.segmentState.update({
          where: { id: state.id },
          data: { draft: input.answer },
        });
        return { ok: true };
      }
      if (input.action === 'reveal') {
        await tx.segmentState.update({
          where: { id: state.id },
          data: { revealed: true },
        });
        return { text: segment.text };
      }
      if (input.action === 'skip') {
        await tx.segmentState.update({
          where: { id: state.id },
          data: { status: state.status === 'correct' ? 'correct' : 'skipped' },
        });
        await tx.progress.update({
          where: { id: progress.id },
          data: { currentIndex: activeIndex + 1, mode: input.mode },
        });
        return { nextIndex: activeIndex + 1 };
      }
      if (input.action !== 'submit')
        throw new HttpError(400, '지원하지 않는 동작입니다.');
      // 네트워크 재전송은 같은 결과를 돌려주되 다른 답안의 요청 ID 재사용은 거부한다.
      const existing = await tx.attempt.findUnique({
        where: { id: input.requestId },
      });
      if (existing) {
        if (
          existing.progressId !== progress.id ||
          existing.segmentId !== segment.id ||
          existing.mode !== input.mode ||
          JSON.stringify(existing.answer) !== JSON.stringify(input.answer)
        )
          throw new HttpError(409, '이미 사용된 요청입니다.');
        return {
          grade: existing.result,
          nextIndex: existing.correct ? activeIndex + 1 : activeIndex,
        };
      }
      const result = gradeAnswer(
        segment.text,
        input.mode as Mode,
        input.answer
      );
      await tx.attempt.create({
        data: {
          id: input.requestId,
          ...key,
          answer: input.answer,
          result: result as unknown as Prisma.InputJsonValue,
          correct: result.correct,
        },
      });
      await tx.segmentState.update({
        where: { id: state.id },
        data: {
          draft: input.answer,
          status: result.correct ? 'correct' : state.status,
        },
      });
      const nextIndex = result.correct ? activeIndex + 1 : activeIndex;
      await tx.progress.update({
        where: { id: progress.id },
        data: { currentIndex: nextIndex, mode: input.mode },
      });
      return { grade: result, nextIndex };
    });
  }
}
