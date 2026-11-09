import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { Job } from '../database/entities/Job.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { User } from '../database/entities/User.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import { Attempt } from '../database/entities/Attempt.entity.js';
import { SegmentState } from '../database/entities/SegmentState.entity.js';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VideosService } from './videos.service.js';
import { CatalogService } from './catalog.service.js';
import { SettingsService } from '../users/settings.service.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('개인 목록과 공용 영상 DB 통합', () => {
  const db = new DataSource(databaseOptions(testUrl));

  const videos = new VideosService(db);
  const catalog = new CatalogService(db);
  const settings = new SettingsService(db);

  const userId = randomUUID(),
    otherId = randomUUID(),
    strangerId = randomUUID();

  const ids = Array.from({ length: 3 }, () => randomUUID());
  const segmentId = randomUUID();
  const category = `분류-${randomUUID()}`;
  const youtubeId = randomUUID().replaceAll('-', '').slice(0, 11);

  beforeAll(async () => {
    await db.initialize();

    await db.manager.insert(User, [
      { id: userId },
      { id: otherId },
      { id: strangerId },
    ]);

    for (const [index, id] of ids.entries()) {
      await db.manager.insert(Video, {
        id,
        youtubeId:
          index === 0
            ? youtubeId
            : randomUUID().replaceAll('-', '').slice(0, 11),
        title: `검증 영상 ${index}`,
        category,
        createdAt: new Date(2026, 0, index + 1),
      });

      await db.manager.insert(Job, {
        videoId: id,
        status: index === 2 ? 'failed' : 'ready',
      });

      await db.manager.insert(Segment, {
        videoId: id,
        id: index === 0 ? segmentId : randomUUID(),
        index: 0,
        start: 1,
        end: 3,
        text: 'Hello world.',
        words: [],
      });
    }

    await db.manager.insert(Progress, [
      { userId, videoId: ids[0], currentIndex: 1 },
      { userId: otherId, videoId: ids[0] },
    ]);
  });

  afterAll(async () => {
    await db.manager.delete(User, { id: In([userId, otherId, strangerId]) });
    await db.manager.delete(Video, { id: In(ids) });
    await db.destroy();
  });

  it('재생 설정은 계정별로 저장되며 다른 영상과 초기화 뒤에도 유지된다', async () => {
    expect(await settings.get(otherId)).toEqual({
      autoReplay: false,
      replayDelay: 1,
      replayCount: null,
      playbackRate: 1,
    });

    const options = {
      autoReplay: true,
      replayDelay: 3,
      replayCount: 5,
      playbackRate: 0.75,
    } as const;

    await settings.update(userId, options);
    await db.manager.insert(Progress, { userId, videoId: ids[1] });

    try {
      expect((await videos.getLesson(userId, ids[0])).settings).toEqual(
        options
      );

      expect((await videos.getLesson(userId, ids[1])).settings).toEqual(
        options
      );

      await videos.applyAction(userId, ids[1], { action: 'reset' });
      expect(await settings.get(userId)).toEqual(options);
      expect((await settings.get(otherId)).autoReplay).toBe(false);
    } finally {
      await db.manager.delete(Progress, { userId, videoId: ids[1] });
    }
  });

  it('관심 영상과 안 들리는 구절은 개인별로 저장하며 중복되지 않는다', async () => {
    await videos.setFavorite(userId, ids[0], true);

    await videos.applyAction(userId, ids[0], {
      action: 'difficulty',
      segmentId,
      marked: true,
    });

    await videos.applyAction(userId, ids[0], {
      action: 'difficulty',
      segmentId,
      marked: true,
    });

    const lesson = await videos.getLesson(userId, ids[0]);

    expect(lesson.difficultSegmentIds).toEqual([segmentId]);
    expect(lesson.progress).toMatchObject({ favorite: true, currentIndex: 1 });

    expect(
      (await videos.getLesson(otherId, ids[0])).difficultSegmentIds
    ).toEqual([]);

    expect((await videos.list(userId))[0]).toMatchObject({
      favorite: true,
      difficultCount: 1,
    });

    await expect(
      videos.applyAction(userId, ids[0], {
        action: 'difficulty',
        segmentId: '다른-영상-구절',
        marked: true,
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('목록 제거 후 재등록하면 진도와 표시가 복원된다', async () => {
    await videos.removeFromLibrary(userId, ids[0]);
    expect(await videos.list(userId)).toEqual([]);
    expect(await videos.list(otherId)).toHaveLength(1);
    await videos.registerVideo(userId, `https://youtu.be/${youtubeId}`);

    expect((await videos.list(userId))[0]).toMatchObject({
      currentIndex: 1,
      favorite: true,
      difficultCount: 1,
    });
  });

  it('공용 인기순은 좋아요를 집계하며 개인 표시와 실패한 영상을 노출하지 않는다', async () => {
    await videos.setLike(userId, ids[0], true);

    const first = await catalog.list({
      category,
      sort: 'popular',
      page: 1,
      limit: 1,
    });

    expect(first.hasMore).toBe(true);
    expect(first.items[0]).toMatchObject({ id: ids[0], likeCount: 1 });
    expect(first.items[0]).not.toHaveProperty('favorite');
    expect(first.items[0]).not.toHaveProperty('progress');

    expect(
      (
        await catalog.list({
          category,
          q: '%',
          sort: 'latest',
          page: 1,
          limit: 20,
        })
      ).items
    ).toEqual([]);

    const next = await catalog.list({
      category,
      sort: 'popular',
      page: 2,
      limit: 1,
    });

    expect(next.items[0].id).toBe(ids[1]);
    expect(next.hasMore).toBe(false);

    const latest = await catalog.list({
      category,
      sort: 'latest',
      page: 1,
      limit: 20,
    });

    expect(latest.items.map((item) => item.id)).toEqual([ids[1], ids[0]]);
    expect(await catalog.categories()).toContainEqual({ category, count: 2 });
  });

  it('초기화는 구절 표시를 지우되 관심 영상과 좋아요는 보존한다', async () => {
    await videos.applyAction(userId, ids[0], { action: 'reset' });
    const lesson = await videos.getLesson(userId, ids[0]);

    expect(lesson.difficultSegmentIds).toEqual([]);
    expect(lesson.progress).toMatchObject({ favorite: true, currentIndex: 0 });
    expect(lesson.video.liked).toBe(true);
  });

  it('비공개 재등록과 권한 철회를 차단하며 과거 답안은 지우지 않는다', async () => {
    const progress = await db.manager.findOneByOrFail(Progress, {
      userId: otherId,
      videoId: ids[0],
    });

    const attemptId = randomUUID();

    await db.manager.insert(Attempt, {
      id: attemptId,
      progressId: progress.id,
      segmentId,
      mode: 'full',
      answer: 'old answer',
      correct: false,
      result: { sourceText: 'Hello world.', sourceVersion: 1 },
    });

    await db.manager.update(
      Video,
      { id: ids[0] },
      { ownerId: userId, visibility: 'private' }
    );

    try {
      await expect(
        videos.registerVideo(strangerId, `https://youtu.be/${youtubeId}`)
      ).rejects.toMatchObject({ status: 404 });

      expect(
        await db.manager.count(Progress, {
          where: { userId: strangerId, videoId: ids[0] },
        })
      ).toBe(0);

      await db.manager.update(
        Video,
        { id: ids[0] },
        { visibility: 'accounts', allowedUserIds: [strangerId] }
      );

      await videos.registerVideo(strangerId, `https://youtu.be/${youtubeId}`);

      expect((await videos.getLesson(strangerId, ids[0])).video.id).toBe(
        ids[0]
      );

      await db.manager.update(Video, { id: ids[0] }, { allowedUserIds: [] });
      expect(await videos.list(strangerId)).toEqual([]);

      await expect(
        videos.registerVideo(strangerId, `https://youtu.be/${youtubeId}`)
      ).rejects.toMatchObject({ status: 404 });

      await expect(videos.getLesson(strangerId, ids[0])).rejects.toMatchObject({
        status: 404,
      });

      await expect(
        videos.applyAction(strangerId, ids[0], {
          action: 'reveal',
          mode: 'full',
          segmentId,
          sourceVersion: 1,
        })
      ).rejects.toMatchObject({ status: 404 });

      expect((await videos.getLesson(userId, ids[0])).video.id).toBe(ids[0]);

      expect(
        await db.manager.findOneBy(Attempt, { id: attemptId })
      ).toMatchObject({
        answer: 'old answer',
        result: { sourceText: 'Hello world.', sourceVersion: 1 },
      });
    } finally {
      await db.manager.update(
        Video,
        { id: ids[0] },
        { visibility: 'public', allowedUserIds: [] }
      );
    }
  });

  it('200개 중 199개 정답은 99퍼센트이며 전체 정답에만 완료를 표시한다', async () => {
    await db.manager.insert(
      Segment,
      Array.from({ length: 199 }, (_, index) => ({
        id: randomUUID(),
        videoId: ids[0],
        index: index + 1,
        start: index + 3,
        end: index + 4,
        text: 'A sentence.',
        words: [],
      }))
    );

    const segments = await db.manager.find(Segment, {
      where: { videoId: ids[0] },
      order: { index: 'ASC' },
    });

    const progress = await db.manager.findOneByOrFail(Progress, {
      userId,
      videoId: ids[0],
    });

    const state = (id: string) => ({
      progressId: progress.id,
      segmentId: id,
      mode: 'full',
      blankRatio: 0,
      sourceVersion: 1,
      draft: '',
      status: 'correct',
    });

    await db.manager.insert(
      SegmentState,
      segments.slice(0, 199).map((segment) => state(segment.id))
    );

    expect(await videos.getLesson(userId, ids[0])).toMatchObject({
      completedCount: 199,
      progressPercent: 99,
      isComplete: false,
    });

    expect(
      (await videos.list(userId)).find((item) => item.videoId === ids[0])
    ).toMatchObject({ progressPercent: 99, isComplete: false });

    await db.manager.insert(SegmentState, state(segments[199].id));

    expect(await videos.getLesson(userId, ids[0])).toMatchObject({
      completedCount: 200,
      progressPercent: 100,
      isComplete: true,
    });

    expect(
      (await videos.list(userId)).find((item) => item.videoId === ids[0])
    ).toMatchObject({ progressPercent: 100, isComplete: true });
  });
});
