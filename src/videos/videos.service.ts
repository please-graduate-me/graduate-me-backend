import {
  awardLearningReward,
  learningRewardReceipt,
} from '../growth/rewards.js';
import { VideoPlayback } from '../database/entities/VideoPlayback.entity.js';
import { playbackDto, playbackSnapshot } from './playback.js';
import { materialPolicy } from '../learning/material-policy.js';
import { DataSource, MoreThanOrEqual } from 'typeorm';
import { Video } from '../database/entities/Video.entity.js';
import { SegmentState } from '../database/entities/SegmentState.entity.js';
import { Job } from '../database/entities/Job.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import { VideoLike } from '../database/entities/VideoLike.entity.js';
import { Attempt } from '../database/entities/Attempt.entity.js';
import { SegmentDifficulty } from '../database/entities/SegmentDifficulty.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { blankIndices, gradeAnswer, learningUnits } from './grading.js';
import { Inject, Injectable } from '@nestjs/common';
import { recommendations } from './catalog.js';
import { gradeSchema, type Mode } from './contracts.js';
import { type LearningAction } from './actions.js';
import { HttpError } from '../common/http-error.js';
import { parseYouTubeUrl } from './youtube.js';
import { requireReadableVideo } from './access.js';

function progressPercent(completed: number, count: number) {
  if (!count) return 0;

  return completed === count
    ? 100
    : Math.min(99, Math.round((completed / count) * 100));
}

/** 영상과 계정별 진도 변경을 트랜잭션 경계 안에서 처리한다. */
@Injectable()
export class VideosService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async list(userId: string) {
    const rows = await this.db
      .getRepository(Progress)
      .createQueryBuilder('p')
      .innerJoin('p.video', 'v')
      .leftJoin('v.job', 'j')
      .select('p.videoId', 'videoId')
      .addSelect('v.title', 'title')
      .addSelect('v.youtubeId', 'youtubeId')
      .addSelect('v.category', 'category')
      .addSelect('v.language', 'language')
      .addSelect('p.currentIndex', 'currentIndex')
      .addSelect('p.favorite', 'favorite')
      .addSelect('p.updatedAt', 'updatedAt')
      .addSelect("COALESCE(j.status, 'queued')", 'status')
      .addSelect(
        '(SELECT count(*)::int FROM "VideoLike" l WHERE l."videoId" = v.id)',
        'likeCount'
      )
      .addSelect(
        '(SELECT count(*)::int FROM "Segment" s WHERE s."videoId" = v.id)',
        'count'
      )
      .addSelect(
        '(SELECT count(*)::int FROM "SegmentDifficulty" d JOIN "Segment" s ON s.id = d."segmentId" WHERE d."progressId" = p.id)',
        'difficultCount'
      )
      .addSelect(
        `(SELECT count(DISTINCT s."segmentId")::int FROM "SegmentState" s JOIN "Segment" current ON current.id = s."segmentId" WHERE s."progressId" = p.id AND s.status = 'correct' AND s."sourceVersion" = current.version)`,
        'completedCount'
      )
      .where('p.userId = :userId AND p.archivedAt IS NULL', { userId })
      .andWhere(
        `(v."ownerId" = :userId OR v.visibility = 'public' OR (v.visibility = 'accounts' AND v."allowedUserIds" ? :userId))`
      )
      .orderBy('p.updatedAt', 'DESC')
      .getRawMany<{
        videoId: string;
        title: string;
        youtubeId: string;
        category: string | null;
        language: 'en' | 'th';
        currentIndex: number;
        favorite: boolean;
        updatedAt: Date;
        status: string;
        likeCount: number;
        count: number;
        difficultCount: number;
        completedCount: number;
      }>();

    return rows.map((row) => ({
      ...row,
      progressPercent: progressPercent(row.completedCount, row.count),
      isComplete: row.count > 0 && row.completedCount === row.count,
    }));
  }
  async registerVideo(
    userId: string,
    url: string,
    language: 'en' | 'th' = 'en'
  ) {
    let youtubeId: string;

    try {
      youtubeId = parseYouTubeUrl(url);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }

    return this.db.transaction(async (tx) => {
      const analysisVersion = /^[a-zA-Z0-9._-]{1,50}$/.test(
        process.env.VIDEO_ANALYSIS_VERSION || ''
      )
        ? process.env.VIDEO_ANALYSIS_VERSION!
        : 'v1';

      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `video-register:${userId}`,
      ]);

      // 같은 영상의 동시 등록이 작업을 중복 생성하지 않도록 직렬화한다.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${youtubeId}:${language}:${analysisVersion}`,
      ]);

      let video = await tx.findOne(Video, {
        where: { youtubeId, language, analysisVersion },
        lock: { mode: 'pessimistic_read' },
      });

      // 완료된 동일 분석은 재사용하고 신규 비용과 일일 등록 한도는 새 자료에만 적용한다.
      if (!video) {
        this.requireTranscriptionEnabled();

        const limit = materialPolicy().video.dailyNewLimit;

        const today = new Date();

        today.setUTCHours(0, 0, 0, 0);
        if (
          (await tx.count(Video, {
            where: { ownerId: userId, createdAt: MoreThanOrEqual(today) },
          })) >= limit
        )
          throw new HttpError(
            429,
            '오늘 등록할 수 있는 새 영상 수를 초과했습니다. 저장된 자료는 계속 학습할 수 있습니다.'
          );

        const inserted = await tx.insert(Video, {
          youtubeId,
          language,
          analysisVersion,
          ownerId: userId,
          visibility: 'private',
          title:
            recommendations.find((item) => item.youtubeId === youtubeId)
              ?.title ?? '영상 정보를 확인하고 있어요',
        });

        video = await tx.findOneByOrFail(Video, {
          id: inserted.identifiers[0].id as string,
        });
      }

      await requireReadableVideo({ manager: tx }, userId, video.id);

      const job = await tx.findOne(Job, { where: { videoId: video.id } });

      if (!job) {
        this.requireTranscriptionEnabled();
        await tx.insert(Job, { videoId: video.id });
      }

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
  private requireTranscriptionEnabled() {
    const provider =
      process.env.VIDEO_TRANSCRIPTION_PROVIDER?.trim() || 'gemini';

    if (provider !== 'gemini')
      throw new HttpError(
        503,
        '현재 새 영상 분석을 사용할 수 없습니다. 준비된 영상은 계속 학습할 수 있습니다.'
      );
  }
  async retryVideo(userId: string, videoId: string) {
    const progress = await this.db.manager.findOne(Progress, {
      where: { userId, videoId },
    });

    if (!progress) throw new HttpError(404, '학습 영상을 찾을 수 없습니다.');

    throw new HttpError(410, '실패한 자료의 분석 재시도는 제공하지 않습니다.');
  }
  async getLesson(userId: string, videoId: string) {
    await requireReadableVideo(this.db, userId, videoId);

    const progress = await this.db.manager.findOne(Progress, {
      where: { userId, videoId },
      relations: { states: true, user: true, video: { job: true } },
    });

    if (!progress) throw new HttpError(404, '학습 영상을 찾을 수 없습니다.');
    const { video, states } = progress;

    const [segments, difficulties, likeCount, liked] = await Promise.all([
      this.db.manager.find(Segment, {
        where: { videoId },
        order: { index: 'ASC' },
      }),
      this.db.manager.find(SegmentDifficulty, {
        where: { progressId: progress.id },
      }),
      this.db.manager.count(VideoLike, { where: { videoId } }),
      this.db.manager.exists(VideoLike, { where: { userId, videoId } }),
    ]);

    const watch = playbackSnapshot(video, segments, progress.cycle);

    const playback = await this.db.manager.findOneBy(VideoPlayback, {
      progressId: progress.id,
      watchVersion: watch.watchVersion,
    });

    const { autoReplay, replayDelay, replayCount, playbackRate } =
      progress.user;

    // 두 받아쓰기 모드의 정답도 한 구절로 세고 수정 전 버전의 정답은 현재 진도에서 제외한다.
    const completedCount = new Set(
      states
        .filter(
          (state) =>
            state.status === 'correct' &&
            segments.some(
              (segment) =>
                segment.id === state.segmentId &&
                segment.version === state.sourceVersion
            )
        )
        .map((state) => state.segmentId)
    ).size;

    return {
      settings: { autoReplay, replayDelay, replayCount, playbackRate },
      video: {
        id: video.id,
        youtubeId: video.youtubeId,
        title: video.title,
        duration: video.duration,
        category: video.category,
        language: video.language,
        analysisVersion: video.analysisVersion,
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
        ...playbackDto(playback, watch.watchVersion),
        currentIndex: progress.currentIndex,
        mode:
          progress.mode === 'blank' && video.blankStatus !== 'ready'
            ? 'full'
            : progress.mode,
        blankRatio: progress.blankRatio,
        cycle: progress.cycle,
        scriptViewed: progress.scriptViewed,
        favorite: progress.favorite,
      },
      completedCount,
      progressPercent: progressPercent(completedCount, segments.length),
      isComplete: segments.length > 0 && completedCount === segments.length,
      preparation: {
        transcription:
          video.job?.status === 'ready'
            ? 'ready'
            : video.job?.status === 'failed'
              ? 'failed'
              : 'pending',
        translation: video.translationStatus,
        blanks: video.blankStatus,
        error: video.processingError,
      },
      difficultSegmentIds: difficulties.map((item) => item.segmentId),
      segments: segments.map((segment, index) => {
        const units = learningUnits(segment.text, video.language);

        const blanks = blankIndices(
          segment.text,
          progress.blankRatio,
          segment.blankCandidates,
          video.language
        );

        const eligible = units.filter((unit) =>
          /[\p{L}\p{N}]/u.test(unit)
        ).length;

        return {
          ...segment,
          index,
          units,
          translation:
            progress.scriptViewed ||
            states.some(
              (state) =>
                state.segmentId === segment.id &&
                state.sourceVersion === segment.version &&
                (state.revealed || state.status === 'correct')
            )
              ? segment.translation
              : null,
          blanks,
          blankActualRatio: eligible
            ? Math.round((blanks.length / eligible) * 100)
            : 0,
        };
      }),
      states: states
        .filter((state) =>
          segments.some(
            (segment) =>
              segment.id === state.segmentId &&
              segment.version === state.sourceVersion
          )
        )
        .map((state) => ({
          segmentId: state.segmentId,
          mode: state.mode,
          blankRatio: state.blankRatio,
          hintCount: state.hintCount,
          sourceVersion: state.sourceVersion,
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

      const video = await requireReadableVideo(
        { manager: tx },
        userId,
        videoId
      );

      // 운영자와 같은 구절→진도 순서로 잠가 원문 교체 중 제출과 교착을 막는다.
      const segment =
        'segmentId' in input
          ? await tx.findOne(Segment, {
              where: { id: input.segmentId, videoId },
              lock: { mode: 'pessimistic_read' },
            })
          : null;

      if ('segmentId' in input && !segment)
        throw new HttpError(
          404,
          '이 구절이 없거나 학습 목록에서 제외되었습니다. 새로고침해 주세요.'
        );
      if (
        'sourceVersion' in input &&
        input.sourceVersion !== undefined &&
        segment?.version !== input.sourceVersion
      )
        throw new HttpError(
          409,
          '원문이 변경되었습니다. 최신 구절을 확인한 뒤 다시 학습해 주세요.'
        );

      const progress = await tx.findOne(Progress, {
        where: { userId, videoId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!progress) throw new HttpError(404, '학습 영상을 찾을 수 없습니다.');

      const job = await tx.findOne(Job, { where: { videoId } });

      if (job?.status !== 'ready')
        throw new HttpError(409, '영상 처리가 아직 완료되지 않았습니다.');
      const ratio = progress.blankRatio || 20;
      const language = video?.language ?? 'en';

      if (input.action === 'watchPosition') {
        const timeline = await tx.find(Segment, {
          where: { videoId },
          order: { index: 'ASC' },
          select: { id: true, version: true, start: true, end: true },
        });

        const watch = playbackSnapshot(video, timeline, progress.cycle);

        if (!timeline.length || input.watchVersion !== watch.watchVersion)
          throw new HttpError(
            409,
            '원문 또는 학습 회차가 변경되었습니다. 재생 위치를 다시 확인해 주세요.'
          );

        const maximum =
          video.duration ?? Math.max(...timeline.map((segment) => segment.end));

        if (
          !Number.isFinite(maximum) ||
          maximum <= 0 ||
          input.position > maximum
        )
          throw new HttpError(400, '영상 재생 시간 범위를 확인해 주세요.');

        const existing = await tx.findOneBy(VideoPlayback, {
          progressId: progress.id,
          watchVersion: watch.watchVersion,
        });

        if (existing?.lastRequestId === input.requestId) {
          if (
            existing.lastInput.position !== input.position ||
            existing.lastInput.watchMode !== input.watchMode ||
            existing.lastInput.expectedRevision !== input.expectedRevision
          )
            throw new HttpError(
              409,
              '이미 사용한 재생 위치 요청 식별자입니다.'
            );

          return { ok: true, ...playbackDto(existing, watch.watchVersion) };
        }

        // 같은 회차의 늦은 자동 저장이나 다른 기기의 저장이 새 탐색 위치를 덮어쓰지 않게 한다.
        if ((existing?.revision ?? 0) !== input.expectedRevision)
          throw new HttpError(
            409,
            '다른 재생 위치가 먼저 저장되었습니다. 저장된 위치를 다시 확인해 주세요.'
          );

        const position = Math.min(
          maximum,
          Math.round(input.position * 1000) / 1000
        );

        const saved = await tx.save(VideoPlayback, {
          ...existing,
          progressId: progress.id,
          watchVersion: watch.watchVersion,
          analysisVersion: video.analysisVersion,
          sourceSnapshot: watch.snapshot,
          cycle: progress.cycle,
          revision: (existing?.revision ?? 0) + 1,
          lastRequestId: input.requestId,
          lastInput: input,
          playbackPosition:
            input.watchMode === 'dictation'
              ? position
              : (existing?.playbackPosition ?? 0),
          scriptPosition:
            input.watchMode === 'script'
              ? position
              : (existing?.scriptPosition ?? 0),
          scriptMaxPosition:
            input.watchMode === 'script'
              ? Math.max(existing?.scriptMaxPosition ?? 0, position)
              : (existing?.scriptMaxPosition ?? 0),
        });

        if (input.watchMode === 'script') {
          // 스크립트 시청은 도움 열람만 표시하며 정답 상태나 활성 받아쓰기 구절은 바꾸지 않는다.
          await tx.update(
            Progress,
            { id: progress.id },
            { scriptViewed: true }
          );

          await tx.update(
            SegmentState,
            { progressId: progress.id },
            { revealed: true }
          );
        }

        return { ok: true, ...playbackDto(saved, watch.watchVersion) };
      }

      if (input.action === 'reset') {
        // 공유 영상은 보존하고 잠근 사용자 진도에 속한 두 모드의 기록만 지운다.
        await tx.delete(SegmentDifficulty, { progressId: progress.id });

        await tx.delete(SegmentState, { progressId: progress.id });

        await tx.update(
          Progress,
          { id: progress.id },
          {
            currentIndex: 0,
            mode: video?.blankStatus === 'ready' ? 'blank' : 'full',
            scriptViewed: false,
            cycle: (progress.cycle || 0) + 1,
          }
        );

        return { ok: true };
      }

      if (input.action === 'viewScript') {
        await tx.update(Progress, { id: progress.id }, { scriptViewed: true });

        await tx.update(
          SegmentState,
          { progressId: progress.id },
          { revealed: true }
        );

        return { ok: true };
      }

      if (input.action === 'blankRatio') {
        if (video?.blankStatus && video.blankStatus !== 'ready')
          throw new HttpError(
            409,
            '빈칸 후보가 준비되지 않았습니다. 전체 받아쓰기와 스크립트를 이용해 주세요.'
          );

        await tx.update(
          Progress,
          { id: progress.id },
          { blankRatio: input.ratio }
        );

        return { ok: true };
      }

      const activeSegments = await tx.find(Segment, {
        where: { videoId },
        select: { id: true },
        order: { index: 'asc' },
      });

      const count = activeSegments.length;

      if (input.action === 'navigate') {
        if (
          input.mode === 'blank' &&
          video?.blankStatus &&
          video.blankStatus !== 'ready'
        )
          throw new HttpError(
            409,
            '빈칸 후보가 준비되지 않았습니다. 전체 받아쓰기를 이용해 주세요.'
          );
        if (input.index > count)
          throw new HttpError(400, '구절 범위를 벗어났습니다.');

        await tx.update(
          Progress,
          { id: progress.id },
          { currentIndex: input.index, mode: input.mode }
        );

        return { ok: true };
      }

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
            input.answer.length !==
              blankIndices(
                segment.text,
                ratio,
                segment.blankCandidates,
                language
              ).length)
      ) {
        throw new HttpError(400, '학습 모드에 맞는 답안을 입력해 주세요.');
      }

      const key = {
        progressId: progress.id,
        segmentId: segment.id,
        mode: input.mode,
        blankRatio: input.mode === 'full' ? 0 : ratio,
        sourceVersion: segment.version || 1,
      };

      if (
        input.mode === 'blank' &&
        video?.blankStatus &&
        video.blankStatus !== 'ready'
      )
        throw new HttpError(
          409,
          '빈칸 후보가 준비되지 않았습니다. 전체 받아쓰기를 이용해 주세요.'
        );

      await tx
        .createQueryBuilder()
        .insert()
        .into(SegmentState)
        .values({
          ...key,
          draft: input.mode === 'full' ? '' : [],
          revealed: progress.scriptViewed || false,
        })
        .orIgnore()
        .execute();

      const state = await tx.findOneByOrFail(SegmentState, key);

      if (input.action === 'hint') {
        const units = learningUnits(segment.text, language);

        const words =
          input.mode === 'full'
            ? units.filter((unit) => /[\p{L}\p{N}]/u.test(unit))
            : blankIndices(
                segment.text,
                ratio,
                segment.blankCandidates,
                language
              ).map((index) => units[index]);

        const hint = words
          .map(
            (word) =>
              `${Array.from(new Intl.Segmenter(language, { granularity: 'grapheme' }).segment(word))[0]?.segment || ''}…`
          )
          .join(' ');

        await tx.update(
          SegmentState,
          { id: state.id },
          { hintCount: (state.hintCount || 0) + 1 }
        );

        return { hint, hintCount: (state.hintCount || 0) + 1 };
      }

      if (input.action === 'draft') {
        await tx.update(
          SegmentState,
          { id: state.id },
          { draft: input.answer }
        );

        await tx.update(Progress, { id: progress.id }, { mode: input.mode });

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
          (existing.result.blankRatio ??
            (existing.mode === 'full' ? 0 : 20)) !== key.blankRatio ||
          JSON.stringify(existing.answer) !== JSON.stringify(input.answer)
        )
          throw new HttpError(409, '이미 사용된 요청입니다.');

        return {
          grade: gradeSchema.parse(existing.result),
          reward: await learningRewardReceipt(tx, userId, input.requestId),
          nextIndex: existing.correct ? activeIndex + 1 : activeIndex,
        };
      }

      const result = gradeAnswer(
        segment.text,
        input.mode as Mode,
        input.answer,
        ratio,
        segment.blankCandidates,
        language
      );

      await tx.insert(Attempt, {
        id: input.requestId,
        ...key,
        answer: input.answer,
        result: {
          ...result,
          sourceText: segment.text,
          sourceVersion: segment.version || 1,
          blankRatio: key.blankRatio,
          rulesVersion: 'trim-exact-v1',
          revealed: state.revealed || progress.scriptViewed || false,
          hintCount: state.hintCount || 0,
          cycle: progress.cycle || 0,
        },
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

      const reward = result.correct
        ? await awardLearningReward(
            tx,
            userId,
            'video',
            segment.id,
            input.requestId,
            Boolean(state.revealed || progress.scriptViewed || state.hintCount)
          )
        : null;

      return { grade: result, nextIndex, reward };
    });
  }
}
