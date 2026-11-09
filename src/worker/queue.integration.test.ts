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
import { QueueService } from './queue.service.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('NestJS 작업 큐 DB 통합', () => {
  const db = new DataSource(databaseOptions(testUrl));
  const queue = new QueueService(db);
  let videoId: string;
  let jobId: string;

  const metadata = {
    type: 'transcribing',
    title: '검증 영상',
    duration: 20,
    category: '교육',
    youtubeCategoryId: '27',
  } as const;

  const completed = {
    type: 'complete',
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

    // DB 시각의 밀리초 반올림으로 새 작업이 미래로 판정되지 않게 한다.
    await db.manager.insert(Job, {
      id: jobId,
      videoId,
      availableAt: new Date(Date.now() - 1000),
    });
  });

  afterEach(async () => {
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
    };

    expect(await queue.complete(job, result)).toBe(true);
    expect(await queue.complete(job, result)).toBe(false);
    expect(await db.manager.count(Segment, { where: { videoId } })).toBe(1);

    expect((await db.manager.findOneByOrFail(Job, { id: jobId })).status).toBe(
      'ready'
    );
  });

  it('Gemini 구절과 완료 상태를 함께 저장한다', async () => {
    const job = (await queue.claim())!;

    await queue.transcribing(job, metadata);

    expect(
      await queue.complete(job, {
        type: 'complete',
        segments: [
          { index: 0, start: 1, end: 3, text: 'Hello world.', words: [] },
        ],
      })
    ).toBe(true);

    expect(
      await db.manager.findOneByOrFail(Video, { id: videoId })
    ).toMatchObject({
      title: metadata.title,
      duration: metadata.duration,
    });

    expect(await db.manager.findOneByOrFail(Job, { id: jobId })).toMatchObject({
      status: 'ready',
      leaseToken: null,
    });

    expect(
      await db.manager.findOneByOrFail(Segment, { videoId })
    ).toMatchObject({ text: 'Hello world.', words: [] });
  });

  it('영상 정보와 분류를 저장하고 오래된 소유권의 갱신은 거부한다', async () => {
    const job = (await queue.claim())!;

    await expect(
      queue.transcribing({ ...job, leaseToken: '만료' }, metadata)
    ).rejects.toThrow();

    await queue.transcribing(job, metadata);

    expect(
      await db.manager.findOneByOrFail(Video, { id: videoId })
    ).toMatchObject({
      title: metadata.title,
      duration: metadata.duration,
      category: '교육',
      youtubeCategoryId: '27',
    });
  });

  it('중단된 작업은 실패로 종료하고 이전 워커가 결과를 저장하지 못한다', async () => {
    const old = (await queue.claim())!;

    await db.manager.update(Job, jobId, {
      heartbeatAt: new Date(Date.now() - 180000),
    });

    expect(await queue.claim()).toBeNull();
    expect(await queue.heartbeat(old)).toBe(false);

    expect(await queue.complete(old, { ...completed, segments: [] })).toBe(
      false
    );

    await expect(queue.transcribing(old, metadata)).rejects.toThrow();

    expect((await db.manager.findOneByOrFail(Job, { id: jobId })).status).toBe(
      'failed'
    );
  });

  it('일시 실패도 자동 재시도 없이 한 번의 요청으로 종료한다', async () => {
    const job = (await queue.claim())!;

    await queue.fail(job, 'NETWORK', '일시 실패');
    expect(await queue.claim()).toBeNull();

    expect(await db.manager.findOneByOrFail(Job, { id: jobId })).toMatchObject({
      status: 'failed',
      attempts: 1,
      leaseToken: null,
    });
  });

  it('부분 저장이 실패하면 구절과 완료 상태를 함께 롤백한다', async () => {
    const job = (await queue.claim())!;

    await queue.transcribing(job, metadata);
    const duplicate = { index: 0, start: 1, end: 2, text: 'Hello', words: [] };

    await expect(
      queue.complete(job, {
        type: 'complete',
        segments: [duplicate, duplicate],
      })
    ).rejects.toThrow();

    expect(await db.manager.count(Segment, { where: { videoId } })).toBe(0);

    expect((await db.manager.findOneByOrFail(Job, { id: jobId })).status).toBe(
      'transcribing'
    );
  });
});
