import { DataSource } from 'typeorm';
import { Video } from '../database/entities/Video.entity.js';
import { SegmentState } from '../database/entities/SegmentState.entity.js';
import { Job } from '../database/entities/Job.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import { VideoLike } from '../database/entities/VideoLike.entity.js';
import { Attempt } from '../database/entities/Attempt.entity.js';
import { SegmentDifficulty } from '../database/entities/SegmentDifficulty.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { blankIndices, gradeAnswer } from './grading.js';
import { Inject, Injectable } from '@nestjs/common';
import { recommendations } from './catalog.js';
import { type Mode } from './contracts.js';
import { type LearningAction } from './actions.js';
import { HttpError } from '../common/http-error.js';
import { parseYouTubeUrl } from './youtube.js';

@Injectable()
/** 영상과 계정별 진도 변경을 트랜잭션 경계 안에서 처리한다. */
export class VideosService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async list(userId: string) {
    return this.db
      .getRepository(Progress)
      .createQueryBuilder('p')
      .innerJoin('p.video', 'v')
      .leftJoin('v.job', 'j')
      .select('p.videoId', 'videoId')
      .addSelect('v.title', 'title')
      .addSelect('v.downloadedAt', 'downloadedAt')
      .addSelect('v.category', 'category')
      .addSelect('p.currentIndex', 'currentIndex')
      .addSelect('p.favorite', 'favorite')
      .addSelect('p.updatedAt', 'updatedAt')
      .addSelect("COALESCE(j.status, 'queued')", 'status')
      .addSelect(
        '(SELECT count(*)::int FROM "VideoLike" l WHERE l."videoId" = v.id)',
        'likeCount'
      )
      .addSelect(
        '(SELECT count(*)::int FROM "Segment" s WHERE s."videoId" = v.id AND NOT s.excluded)',
        'count'
      )
      .addSelect(
        '(SELECT count(*)::int FROM "SegmentDifficulty" d JOIN "Segment" s ON s.id = d."segmentId" WHERE d."progressId" = p.id AND NOT s.excluded)',
        'difficultCount'
      )
      .where('p.userId = :userId AND p.archivedAt IS NULL', { userId })
      .orderBy('p.updatedAt', 'DESC')
      .getRawMany<{
        videoId: string;
        title: string;
        downloadedAt: Date | null;
        category: string | null;
        currentIndex: number;
        favorite: boolean;
        updatedAt: Date;
        status: string;
        likeCount: number;
        count: number;
        difficultCount: number;
      }>();
  }
  async registerVideo(userId: string, url: string) {
    let youtubeId: string;

    try {
      youtubeId = parseYouTubeUrl(url);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }

    return this.db.transaction(async (tx) => {
      // 같은 영상의 동시 등록이 작업을 중복 생성하지 않도록 직렬화한다.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [youtubeId]);

      let video = await tx.findOneBy(Video, { youtubeId });

      if (!video) {
        const inserted = await tx.insert(Video, {
          youtubeId,
          title:
            recommendations.find((item) => item.youtubeId === youtubeId)
              ?.title ?? '영상 정보를 확인하고 있어요',
        });

        video = await tx.findOneByOrFail(Video, {
          id: inserted.identifiers[0].id as string,
        });
      }

      const job = await tx.findOne(Job, { where: { videoId: video.id } });

      if (!job && !(process.env.GROQ_API_KEY || process.env.QRUQ_WHISPER))
        throw new HttpError(503, '음성 인식 API 키가 설정되지 않았습니다.');
      if (!job) await tx.insert(Job, { videoId: video.id });

      await tx
        .createQueryBuilder()
        .insert()
        .into(Progress)
        .values({ userId, videoId: video.id })
        .orIgnore()
        .execute();

      await tx.update(
        Progress,
        { userId, videoId: video.id },
        { archivedAt: null }
      );

      return { videoId: video.id };
    });
  }
  async retryVideo(userId: string, videoId: string) {
    const progress = await this.db.manager.findOne(Progress, {
      where: { userId, videoId },
    });

    if (!progress) throw new HttpError(404, '학습 영상을 찾을 수 없습니다.');
    if (!(process.env.GROQ_API_KEY || process.env.QRUQ_WHISPER))
      throw new HttpError(503, '음성 인식 API 키가 설정되지 않았습니다.');

    const updated = await this.db.manager.update(
      Job,
      { videoId, status: 'failed' },
      {
        status: 'queued',
        attempts: 0,
        availableAt: new Date(),
        heartbeatAt: null,
        leaseToken: null,
        errorCode: null,
        errorMessage: null,
      }
    );

    if (!updated.affected)
      throw new HttpError(409, '실패한 작업만 다시 시도할 수 있습니다.');

    return { ok: true };
  }
  async getLesson(userId: string, videoId: string) {
    const progress = await this.db.manager.findOne(Progress, {
      where: { userId, videoId },
      relations: { states: true, user: true, video: { job: true } },
    });

    if (!progress) throw new HttpError(404, '학습 영상을 찾을 수 없습니다.');
    const { video, states } = progress;

    const [segments, difficulties, likeCount, liked] = await Promise.all([
      this.db.manager.find(Segment, {
        where: { videoId, excluded: false },
        order: { index: 'ASC' },
      }),
      this.db.manager.find(SegmentDifficulty, {
        where: { progressId: progress.id, segment: { excluded: false } },
      }),
      this.db.manager.count(VideoLike, { where: { videoId } }),
      this.db.manager.exists(VideoLike, { where: { userId, videoId } }),
    ]);

    const { autoReplay, replayDelay, replayCount, playbackRate } =
      progress.user;

    return {
      settings: { autoReplay, replayDelay, replayCount, playbackRate },
      video: {
        id: video.id,
        youtubeId: video.youtubeId,
        title: video.title,
        duration: video.duration,
        downloadedAt: video.downloadedAt,
        category: video.category,
        liked,
        likeCount,
      },
      job: video.job
        ? {
            status: video.job.status,
            attempts: video.job.attempts,
            errorMessage: video.job.errorMessage,
          }
        : null,
      progress: {
        currentIndex: progress.currentIndex,
        mode: progress.mode,
        favorite: progress.favorite,
      },
      difficultSegmentIds: difficulties.map((item) => item.segmentId),
      segments: segments.map((segment, index) => ({
        ...segment,
        index,
        blanks: blankIndices(segment.text),
      })),
      states: states
        .filter((state) =>
          segments.some((segment) => segment.id === state.segmentId)
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
  async setFavorite(userId: string, videoId: string, favorite: boolean) {
    const result = await this.db.manager.update(
      Progress,
      { userId, videoId },
      { favorite }
    );

    if (!result.affected)
      throw new HttpError(404, '학습 영상을 찾을 수 없습니다.');

    return { ok: true };
  }
  async removeFromLibrary(userId: string, videoId: string) {
    const result = await this.db.manager.update(
      Progress,
      { userId, videoId },
      { archivedAt: new Date() }
    );

    if (!result.affected)
      throw new HttpError(404, '학습 영상을 찾을 수 없습니다.');

    return { ok: true };
  }
  async setLike(userId: string, videoId: string, liked: boolean) {
    return this.db.transaction(async (tx) => {
      // 같은 계정의 동시 요청을 직렬화하고 중복 전송은 같은 상태로 수렴시킨다.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${userId}:${videoId}:like`,
      ]);

      const progress = await tx.findOne(Progress, {
        where: { userId, videoId },
      });

      if (!progress) throw new HttpError(404, '학습 영상을 찾을 수 없습니다.');
      if (liked)
        await tx
          .createQueryBuilder()
          .insert()
          .into(VideoLike)
          .values([{ userId, videoId }])
          .orIgnore()
          .execute();
      else await tx.delete(VideoLike, { userId, videoId });

      return {
        liked,
        likeCount: await tx.count(VideoLike, { where: { videoId } }),
      };
    });
  }
  async applyAction(userId: string, videoId: string, input: LearningAction) {
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM "Video" WHERE id = $1 FOR SHARE', [
        videoId,
      ]);

      const progress = await tx.findOne(Progress, {
        where: { userId, videoId },
      });

      if (!progress) throw new HttpError(404, '학습 영상을 찾을 수 없습니다.');

      // 동일 계정의 저장과 제출이 오래된 진도를 덮어쓰지 않게 한다.
      await tx.query('SELECT id FROM "Progress" WHERE id = $1 FOR UPDATE', [
        progress.id,
      ]);

      const job = await tx.findOne(Job, { where: { videoId } });

      if (job?.status !== 'ready')
        throw new HttpError(409, '영상 처리가 아직 완료되지 않았습니다.');

      if (input.action === 'reset') {
        // 공유 영상은 보존하고 잠근 사용자 진도에 속한 두 모드의 기록만 지운다.
        await tx.delete(Attempt, { progressId: progress.id });

        await tx.delete(SegmentDifficulty, { progressId: progress.id });

        await tx.delete(SegmentState, { progressId: progress.id });

        await tx.update(
          Progress,
          { id: progress.id },
          { currentIndex: 0, mode: 'blank' }
        );

        return { ok: true };
      }

      const activeSegments = await tx.find(Segment, {
        where: { videoId, excluded: false },
        select: { id: true },
        order: { index: 'asc' },
      });

      const count = activeSegments.length;

      if (input.action === 'navigate') {
        if (input.index > count)
          throw new HttpError(400, '구절 범위를 벗어났습니다.');

        await tx.update(
          Progress,
          { id: progress.id },
          { currentIndex: input.index, mode: input.mode }
        );

        return { ok: true };
      }

      const segment = await tx.findOne(Segment, {
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

      if (input.action === 'difficulty') {
        const key = { progressId: progress.id, segmentId: segment.id };

        if (input.marked)
          await tx
            .createQueryBuilder()
            .insert()
            .into(SegmentDifficulty)
            .values([key])
            .orIgnore()
            .execute();
        else await tx.delete(SegmentDifficulty, key);

        return { ok: true };
      }

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

      await tx
        .createQueryBuilder()
        .insert()
        .into(SegmentState)
        .values({ ...key, draft: input.mode === 'full' ? '' : [] })
        .orIgnore()
        .execute();

      const state = await tx.findOneByOrFail(SegmentState, key);

      if (input.action === 'draft') {
        await tx.update(
          SegmentState,
          { id: state.id },
          { draft: input.answer }
        );

        return { ok: true };
      }

      if (input.action === 'reveal') {
        await tx.update(SegmentState, { id: state.id }, { revealed: true });

        return { text: segment.text };
      }

      if (input.action === 'skip') {
        await tx.update(
          SegmentState,
          { id: state.id },
          { status: state.status === 'correct' ? 'correct' : 'skipped' }
        );

        await tx.update(
          Progress,
          { id: progress.id },
          { currentIndex: activeIndex + 1, mode: input.mode }
        );

        return { nextIndex: activeIndex + 1 };
      }

      if (input.action !== 'submit')
        throw new HttpError(400, '지원하지 않는 동작입니다.');

      // 네트워크 재전송은 같은 결과를 돌려주되 다른 답안의 요청 ID 재사용은 거부한다.
      const existing = await tx.findOne(Attempt, {
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

      await tx.insert(Attempt, {
        id: input.requestId,
        ...key,
        answer: input.answer,
        result: { ...result },
        correct: result.correct,
      });

      await tx.update(
        SegmentState,
        { id: state.id },
        {
          draft: input.answer,
          status: result.correct ? 'correct' : state.status,
        }
      );

      const nextIndex = result.correct ? activeIndex + 1 : activeIndex;

      await tx.update(
        Progress,
        { id: progress.id },
        { currentIndex: nextIndex, mode: input.mode }
      );

      return { grade: result, nextIndex };
    });
  }
}
