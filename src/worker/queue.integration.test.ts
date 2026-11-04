import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { Video } from '../database/entities/Video.entity.js';
import { Job } from '../database/entities/Job.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { User } from '../database/entities/User.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import { SegmentState } from '../database/entities/SegmentState.entity.js';
import { Attempt } from '../database/entities/Attempt.entity.js';
import { QueueService } from './queue.service.js';
import { RecheckService } from './recheck.service.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('NestJS 작업 큐와 재검사 DB 통합', () => {
  const db = new DataSource(databaseOptions(testUrl));
  const queue = new QueueService(db);
  const recheck = new RecheckService(db);
  let videoId: string;
  let jobId: string;
  const users: string[] = [];

  const metadata = {
    version: 1,
    type: 'transcribing',
    title: '검증 영상',
    duration: 20,
    category: '교육',
    youtubeCategoryId: '27',
  } as const;

  const completed = {
    version: 1,
    type: 'complete',
    filterVersion: 1,
    speechRegions: [{ start: 1, end: 3 }],
    segments: [{ index: 0, start: 1, end: 3, text: 'Hello world.', words: [] }],
  } as const;

  beforeAll(async () => {
    await db.initialize();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    videoId = randomUUID();
    jobId = randomUUID();

    await db.manager.insert(Video, {
      id: videoId,
      youtubeId: randomUUID().replaceAll('-', '').slice(0, 11),
      title: '큐 검증',
    });

    await db.manager.insert(Job, { id: jobId, videoId });
  });

  afterEach(async () => {
    for (const id of users.splice(0)) await db.manager.delete(User, id);
    await db.manager.delete(Video, videoId);
  });

  it('동시에 가져와도 한 워커만 소유하고 완료 결과는 한 번만 저장한다', async () => {
    const jobs = await Promise.all([queue.claim(), queue.claim()]);
    const claimed = jobs.filter((job) => job !== null);

    expect(claimed).toHaveLength(1);
    const job = claimed[0]!;

    expect(job.id).toBe(jobId);
    expect(await queue.heartbeat(job)).toBe(true);
    await queue.transcribing(job, metadata);

    const result = {
      ...completed,
      segments: [...completed.segments].map((item) => ({ ...item, words: [] })),
      speechRegions: [...completed.speechRegions],
    };

    expect(await queue.complete(job, result)).toBe(true);
    expect(await queue.complete(job, result)).toBe(false);
    expect(await db.manager.count(Segment, { where: { videoId } })).toBe(1);

    expect((await db.manager.findOneByOrFail(Job, { id: jobId })).status).toBe(
      'ready'
    );
  });

  it('다운로드 시각과 분류를 저장하고 오래된 소유권의 갱신은 거부한다', async () => {
    const job = (await queue.claim())!;

    expect(
      (await db.manager.findOneByOrFail(Video, { id: videoId })).downloadedAt
    ).toBeNull();

    await queue.downloaded(job);

    const downloaded = (
      await db.manager.findOneByOrFail(Video, { id: videoId })
    ).downloadedAt;

    expect(downloaded).not.toBeNull();

    await expect(
      queue.downloaded({ ...job, leaseToken: '만료' })
    ).rejects.toThrow();

    await queue.transcribing(job, metadata);

    expect(
      await db.manager.findOneByOrFail(Video, { id: videoId })
    ).toMatchObject({
      downloadedAt: downloaded,
      category: '교육',
      youtubeCategoryId: '27',
    });
  });

  it('중단된 작업을 회수하면 이전 워커는 결과·오류·생존 신호를 저장할 수 없다', async () => {
    const old = (await queue.claim())!;

    await db.manager.update(Job, jobId, {
      heartbeatAt: new Date(Date.now() - 180000),
    });

    const next = (await queue.claim())!;

    expect(next.attempts).toBe(2);
    expect(next.leaseToken).not.toBe(old.leaseToken);
    expect(await queue.heartbeat(old)).toBe(false);

    expect(
      await queue.complete(old, {
        ...completed,
        segments: [],
        speechRegions: [],
      })
    ).toBe(false);

    await expect(queue.transcribing(old, metadata)).rejects.toThrow();
    await queue.fail(old, 'OLD', '이전 작업', false);
    expect(await queue.heartbeat(next)).toBe(true);
  });

  it('일시 실패는 지연 후 재시도하고 세 번째 실패는 종료한다', async () => {
    const job = (await queue.claim())!;

    await queue.fail(job, 'NETWORK', '일시 실패', true);
    expect(await queue.claim()).toBeNull();
    const delayed = await db.manager.findOneByOrFail(Job, { id: jobId });

    expect(delayed.availableAt.getTime()).toBeGreaterThan(Date.now() + 10000);

    await db.manager.update(Job, jobId, {
      attempts: 2,
      availableAt: new Date(Date.now() - 1000),
    });

    const last = (await queue.claim())!;

    expect(last.attempts).toBe(3);
    await queue.fail(last, 'NETWORK', '다시 실패', true);

    expect((await db.manager.findOneByOrFail(Job, { id: jobId })).status).toBe(
      'failed'
    );
  });

  it('부분 저장이 실패하면 구절과 완료 상태를 함께 롤백한다', async () => {
    const job = (await queue.claim())!;

    await queue.transcribing(job, metadata);
    const duplicate = { index: 0, start: 1, end: 2, text: 'Hello', words: [] };

    await expect(
      queue.complete(job, {
        version: 1,
        type: 'complete',
        filterVersion: 1,
        segments: [duplicate, duplicate],
        speechRegions: [{ start: 0, end: 3 }],
      })
    ).rejects.toThrow();

    expect(await db.manager.count(Segment, { where: { videoId } })).toBe(0);

    expect((await db.manager.findOneByOrFail(Job, { id: jobId })).status).toBe(
      'transcribing'
    );

    expect(
      (await db.manager.findOneByOrFail(Video, { id: videoId })).speechRegions
    ).toBeNull();
  });

  it('재검사는 답안과 제출 기록을 보존하며 위치와 완료 상태만 맞춘다', async () => {
    await db.manager.update(Job, jobId, { status: 'ready' });
    const segmentIds = Array.from({ length: 4 }, () => randomUUID());

    await db.manager.insert(
      Segment,
      segmentIds.map((id, index) => ({
        id,
        videoId,
        index,
        start: index * 5,
        end: index * 5 + 2,
        text: '원본',
        words: [],
      }))
    );

    const progressIds: string[] = [];

    for (const currentIndex of [2, 4]) {
      const userId = randomUUID();
      const id = randomUUID();

      users.push(userId);
      progressIds.push(id);
      await db.manager.insert(User, { id: userId });
      await db.manager.insert(Progress, { id, userId, videoId, currentIndex });
    }

    for (const segmentId of segmentIds) {
      await db.manager.insert(SegmentState, {
        progressId: progressIds[0],
        segmentId,
        mode: 'full',
        draft: '답안',
        status: 'correct',
      });

      await db.manager.insert(Attempt, {
        id: randomUUID(),
        progressId: progressIds[0],
        segmentId,
        mode: 'full',
        answer: '답안',
        result: { correct: true },
        correct: true,
      });
    }

    const result = {
      version: 1,
      type: 'rechecked',
      filterVersion: 1,
      speechRegions: [
        { start: 5, end: 7 },
        { start: 10, end: 12 },
      ],
    } as const;

    expect(
      await recheck.apply(videoId, {
        ...result,
        speechRegions: [...result.speechRegions],
      })
    ).toMatchObject({ 제외: 2, 적용: false });

    expect(
      await db.manager.count(Segment, { where: { videoId, excluded: true } })
    ).toBe(0);

    await recheck.apply(
      videoId,
      { ...result, speechRegions: [...result.speechRegions] },
      true
    );

    expect(
      await recheck.apply(
        videoId,
        { ...result, speechRegions: [...result.speechRegions] },
        true
      )
    ).toMatchObject({ 제외: 0 });

    expect(
      (await db.manager.findOneByOrFail(Progress, { id: progressIds[0] }))
        .currentIndex
    ).toBe(1);

    expect(
      (await db.manager.findOneByOrFail(Progress, { id: progressIds[1] }))
        .currentIndex
    ).toBe(2);

    expect(
      await db.manager.count(SegmentState, {
        where: { progressId: progressIds[0] },
      })
    ).toBe(4);

    expect(
      await db.manager.count(Attempt, { where: { progressId: progressIds[0] } })
    ).toBe(4);

    await expect(
      recheck.apply(videoId, { ...result, speechRegions: [] }, true)
    ).rejects.toThrow();
  });
});
