import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { VideosService } from './videos.service.js';
import { CatalogService } from './catalog.service.js';
import { SettingsService } from '../users/settings.service.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('개인 목록과 공용 영상 DB 통합', () => {
  const db = new PrismaService(
    testUrl ? { datasources: { db: { url: testUrl } } } : {}
  );

  const videos = new VideosService(db);
  const catalog = new CatalogService(db);
  const settings = new SettingsService(db);

  const userId = randomUUID(),
    otherId = randomUUID();

  const ids = Array.from({ length: 3 }, () => randomUUID());
  const segmentId = randomUUID();
  const category = `분류-${randomUUID()}`;
  const youtubeId = randomUUID().replaceAll('-', '').slice(0, 11);

  beforeAll(async () => {
    await db.user.createMany({ data: [{ id: userId }, { id: otherId }] });

    for (const [index, id] of ids.entries()) {
      await db.video.create({
        data: {
          id,
          youtubeId:
            index === 0
              ? youtubeId
              : randomUUID().replaceAll('-', '').slice(0, 11),
          title: `검증 영상 ${index}`,
          category,
          createdAt: new Date(2026, 0, index + 1),
          job: { create: { status: index === 2 ? 'failed' : 'ready' } },
          segments: {
            create: {
              id: index === 0 ? segmentId : randomUUID(),
              index: 0,
              start: 1,
              end: 3,
              text: 'Hello world.',
              words: [],
            },
          },
        },
      });
    }

    await db.progress.createMany({
      data: [
        { userId, videoId: ids[0], currentIndex: 1 },
        { userId: otherId, videoId: ids[0] },
      ],
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await db.video.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
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
    await db.progress.create({ data: { userId, videoId: ids[1] } });

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
      await db.progress.deleteMany({ where: { userId, videoId: ids[1] } });
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
});
