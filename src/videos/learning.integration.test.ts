import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { Job } from '../database/entities/Job.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import { Attempt } from '../database/entities/Attempt.entity.js';
import { SegmentState } from '../database/entities/SegmentState.entity.js';
import { VideosService } from './videos.service.js';
import { blankIndices } from './grading.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('TypeORM 학습 저장과 동시 요청', () => {
  const db = new DataSource(databaseOptions(testUrl));
  const service = new VideosService(db);

  const userId = randomUUID(),
    videoId = randomUUID(),
    segmentId = randomUUID();

  const youtubeId = randomUUID().replaceAll('-', '').slice(0, 11);
  const sentence = 'Beautiful flowers bloom.';

  beforeAll(async () => {
    await db.initialize();
    await db.manager.insert(User, { id: userId });

    await db.manager.insert(Video, {
      id: videoId,
      youtubeId,
      title: '학습 저장 검증',
    });

    await db.manager.insert(Job, { videoId, status: 'ready' });

    await db.manager.insert(Segment, {
      id: segmentId,
      videoId,
      index: 0,
      start: 0,
      end: 3,
      text: sentence,
      words: [],
    });
  });

  afterAll(async () => {
    await db.manager.delete(User, { id: userId });
    await db.manager.delete(Video, { id: videoId });
    await db.destroy();
  });

  it('동시 등록과 좋아요 요청은 중복되지 않고 기본 모드는 빈칸 채우기다', async () => {
    await Promise.all([
      service.registerVideo(userId, `https://youtu.be/${youtubeId}`),
      service.registerVideo(userId, `https://youtu.be/${youtubeId}`),
    ]);

    expect(
      await db.manager.count(Progress, { where: { userId, videoId } })
    ).toBe(1);

    expect((await service.getLesson(userId, videoId)).progress.mode).toBe(
      'blank'
    );

    await Promise.all([
      service.setLike(userId, videoId, true),
      service.setLike(userId, videoId, true),
    ]);

    expect((await service.getLesson(userId, videoId)).video.likeCount).toBe(1);
  });

  it('답안과 공개 상태를 저장하고 중복 정답 제출은 한 번만 기록한다', async () => {
    const words = sentence.split(/\s+/);
    const answer = blankIndices(sentence).map((index) => words[index]);

    await service.applyAction(userId, videoId, {
      action: 'draft',
      mode: 'blank',
      segmentId,
      answer,
    });

    await service.applyAction(userId, videoId, {
      action: 'reveal',
      mode: 'blank',
      segmentId,
    });

    const input = {
      action: 'submit',
      mode: 'blank',
      segmentId,
      answer,
      requestId: randomUUID(),
    } as const;

    const results = await Promise.all([
      service.applyAction(userId, videoId, input),
      service.applyAction(userId, videoId, input),
    ]);

    expect(results[0]).toEqual(results[1]);

    expect(results[0]).toMatchObject({
      grade: { correct: true },
      nextIndex: 1,
    });

    expect(
      await db.manager.count(Attempt, { where: { id: input.requestId } })
    ).toBe(1);

    expect((await service.getLesson(userId, videoId)).states[0]).toMatchObject({
      draft: answer,
      status: 'correct',
      revealed: true,
    });

    await expect(
      service.applyAction(userId, videoId, { ...input, answer: ['different'] })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('초기화 뒤에도 재학습과 건너뛰기가 가능하고 답안은 새로 저장된다', async () => {
    await service.applyAction(userId, videoId, { action: 'reset' });

    const progress = await db.manager.findOneByOrFail(Progress, {
      userId,
      videoId,
    });

    expect(
      await db.manager.count(SegmentState, {
        where: { progressId: progress.id },
      })
    ).toBe(0);

    expect(progress.mode).toBe('blank');

    await service.applyAction(userId, videoId, {
      action: 'navigate',
      mode: 'full',
      index: 0,
    });

    await service.applyAction(userId, videoId, {
      action: 'draft',
      mode: 'full',
      segmentId,
      answer: 'Beautiful',
    });

    expect(
      await service.applyAction(userId, videoId, {
        action: 'skip',
        mode: 'full',
        segmentId,
      })
    ).toEqual({ nextIndex: 1 });
  });
});
