import { randomUUID } from 'node:crypto';
import { DataSource, In } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { Job } from '../database/entities/Job.entity.js';
import { VideoPlayback } from '../database/entities/VideoPlayback.entity.js';
import { Attempt } from '../database/entities/Attempt.entity.js';
import { VideosService } from './videos.service.js';
import { actionSchema } from './actions.js';
import { LearningService } from '../learning/learning.service.js';
import { MaterialsService } from '../learning/materials.service.js';
import { ExpressionsService } from '../learning/expressions.service.js';
import { SourceService } from '../learning/source.service.js';
import { QuestionsService } from '../learning/questions.service.js';
import { WorkspaceAccessService } from '../admin/workspace-access.service.js';
import { AdminService } from '../admin/admin.service.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('재생 위치·스크립트 시청과 정답 진도의 분리', () => {
  const db = new DataSource(databaseOptions(testUrl));
  const service = new VideosService(db);

  const owner = randomUUID(),
    other = randomUUID(),
    videoId = randomUUID(),
    segmentId = randomUUID();

  const watch = async (userId = owner) => {
    const progress = (await service.getLesson(userId, videoId)).progress;

    return {
      action: 'watchPosition' as const,
      position: 1,
      watchMode: 'dictation' as const,
      watchVersion: progress.watchVersion,
      expectedRevision: progress.watchRevision,
      requestId: randomUUID(),
    };
  };

  beforeAll(async () => {
    await db.initialize();
    await db.manager.insert(User, [{ id: owner }, { id: other }]);

    await db.manager.insert(Video, {
      id: videoId,
      youtubeId: randomUUID().replaceAll('-', '').slice(0, 11),
      title: '재생 위치 검증',
      duration: 10,
      visibility: 'public',
      blankStatus: 'ready',
    });

    await db.manager.insert(Job, { videoId, status: 'ready' });

    await db.manager.insert(Segment, {
      id: segmentId,
      videoId,
      index: 0,
      start: 0,
      end: 10,
      text: 'A learning example.',
      words: [],
      blankCandidates: [0],
    });

    const video = await db.manager.findOneByOrFail(Video, { id: videoId });

    await service.registerVideo(owner, `https://youtu.be/${video.youtubeId}`);
    await service.registerVideo(other, `https://youtu.be/${video.youtubeId}`);
  });

  afterAll(async () => {
    if (db.isInitialized) {
      await db.manager.delete(User, { id: In([owner, other]) });
      await db.manager.delete(Video, { id: videoId });
      await db.destroy();
    }
  });

  it('실제 시각과 스크립트 위치를 따로 저장하고 어느 쪽도 정답 진도를 올리지 않는다', async () => {
    await service.applyAction(owner, videoId, {
      ...(await watch()),
      position: 4.25,
    });

    await service.applyAction(owner, videoId, {
      ...(await watch()),
      position: 8,
      watchMode: 'script',
    });

    await service.applyAction(owner, videoId, {
      ...(await watch()),
      position: 2,
      watchMode: 'script',
    });

    const lesson = await service.getLesson(owner, videoId);

    expect(lesson.progress).toMatchObject({
      playbackPosition: 4.25,
      scriptPosition: 2,
      scriptMaxPosition: 8,
      watchRevision: 3,
      watchMode: 'script',
      currentIndex: 0,
      scriptViewed: true,
    });

    expect(lesson).toMatchObject({
      completedCount: 0,
      progressPercent: 0,
      isComplete: false,
    });

    expect(lesson.states).toEqual([]);
    expect(await db.manager.count(Attempt)).toBe(0);
  });

  it('같은 요청 재전송은 위치를 다시 쓰지 않고 늦은 저장과 다른 기기 경합은 거부한다', async () => {
    const input = { ...(await watch()), position: 5 };
    const first = await service.applyAction(owner, videoId, input);

    expect(await service.applyAction(owner, videoId, input)).toEqual(first);

    await expect(
      service.applyAction(owner, videoId, { ...input, position: 6 })
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      service.applyAction(owner, videoId, {
        ...input,
        requestId: randomUUID(),
        position: 6,
      })
    ).rejects.toMatchObject({ status: 409 });

    expect(
      (await service.getLesson(owner, videoId)).progress.playbackPosition
    ).toBe(5);

    await expect(
      service.applyAction(owner, videoId, {
        ...(await watch()),
        position: 10.1,
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(
      actionSchema.safeParse({ ...(await watch()), position: Infinity }).success
    ).toBe(false);
  });

  it('개인 위치와 원본 ACL을 분리하고 다른 계정의 위치를 덮어쓰지 않는다', async () => {
    expect(
      (await service.getLesson(other, videoId)).progress.playbackPosition
    ).toBe(0);

    await service.applyAction(other, videoId, {
      ...(await watch(other)),
      position: 7,
    });

    expect(
      (await service.getLesson(owner, videoId)).progress.playbackPosition
    ).toBe(5);

    await db.manager.update(
      Video,
      { id: videoId },
      { visibility: 'private', ownerId: owner }
    );

    await expect(service.getLesson(other, videoId)).rejects.toMatchObject({
      status: 404,
    });

    await expect(
      service.applyAction(other, videoId, { ...(await watch()), position: 1 })
    ).rejects.toMatchObject({ status: 404 });

    await db.manager.update(Video, { id: videoId }, { visibility: 'public' });
  });

  it('원문 구절 버전이 바뀌면 과거 시청을 보존하고 새 버전 위치와 저장을 분리한다', async () => {
    const previous = await watch();

    await db.manager.update(Segment, { id: segmentId }, { version: 2 });
    const lesson = await service.getLesson(owner, videoId);

    expect(lesson.progress.watchVersion).not.toBe(previous.watchVersion);

    expect(lesson.progress).toMatchObject({
      watchRevision: 0,
      playbackPosition: 0,
      scriptPosition: 0,
    });

    await expect(
      service.applyAction(owner, videoId, previous)
    ).rejects.toMatchObject({ status: 409 });

    expect(
      await db.manager.countBy(VideoPlayback, {
        watchVersion: previous.watchVersion,
      })
    ).toBe(2);

    await service.applyAction(owner, videoId, {
      ...(await watch()),
      watchMode: 'script',
      position: 9,
    });
  });

  it('개인 초기화는 새 회차 위치를 사용하고 이전 시청 기록과 실제 활동 이력은 유지한다', async () => {
    const before = await service.getLesson(owner, videoId);

    await service.applyAction(owner, videoId, { action: 'reset' });
    const after = await service.getLesson(owner, videoId);

    expect(after.progress).toMatchObject({
      cycle: 1,
      watchRevision: 0,
      playbackPosition: 0,
      scriptPosition: 0,
      scriptViewed: false,
    });

    expect(after.progress.watchVersion).not.toBe(before.progress.watchVersion);
    const source = new SourceService(db);

    const learning = new LearningService(
      db,
      new MaterialsService(db),
      new ExpressionsService(db, source),
      new QuestionsService(
        db,
        source,
        new WorkspaceAccessService(db, new AdminService(db))
      )
    );

    const history = await learning.history(owner);

    expect(history.items.filter((item) => item.kind === 'watch')).toHaveLength(
      2
    );

    expect(
      history.items.find((item) => item.kind === 'watch')?.detail
    ).toContain('정답 진도와 별도');

    expect(after.progressPercent).toBe(0);
  });
});
