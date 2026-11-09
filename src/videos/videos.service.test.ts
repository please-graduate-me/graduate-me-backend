import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { Progress } from '../database/entities/Progress.entity.js';
import { Job } from '../database/entities/Job.entity.js';
import { Attempt } from '../database/entities/Attempt.entity.js';
import { SegmentState } from '../database/entities/SegmentState.entity.js';
import { SegmentDifficulty } from '../database/entities/SegmentDifficulty.entity.js';
import { VideoLike } from '../database/entities/VideoLike.entity.js';
import { VideosService } from './videos.service.js';

function setup(ownsVideo = true) {
  const insert = {
    insert: vi.fn().mockReturnThis(),
    into: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orIgnore: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({}),
  };

  const tx = {
    query: vi.fn().mockResolvedValue([]),
    findOne: vi
      .fn()
      .mockImplementation(async (entity) =>
        entity === Job
          ? { status: 'ready' }
          : ownsVideo
            ? { id: 'my-progress' }
            : null
      ),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
    count: vi.fn().mockResolvedValue(3),
    createQueryBuilder: vi.fn().mockReturnValue(insert),
  };

  const db = {
    manager: tx,
    transaction: async (
      operation: (transaction: typeof tx) => Promise<unknown>
    ) => operation(tx),
  };

  return {
    tx,
    insert,
    service: new VideosService(db as unknown as DataSource),
  };
}

describe('영상 분석 작업 등록', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('API 서버에 Gemini 키가 없어도 영상 처리 작업을 등록한다', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const { service, tx } = setup();
    const insert = vi.fn().mockResolvedValue({});

    Object.assign(tx, {
      findOneBy: vi.fn().mockResolvedValue({ id: 'shared-video' }),
      insert,
    });

    tx.findOne.mockResolvedValueOnce(null);

    await expect(
      service.registerVideo('me', 'https://youtu.be/VHZI9_we5GQ')
    ).resolves.toEqual({ videoId: 'shared-video' });

    expect(insert).toHaveBeenCalledWith(Job, { videoId: 'shared-video' });
  });

  it('실패 자료의 수동 재시도로 분석 작업을 다시 만들지 않는다', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const { service, tx } = setup();

    await expect(service.retryVideo('me', 'video')).rejects.toMatchObject({
      status: 410,
    });

    expect(tx.update).not.toHaveBeenCalled();
  });
});

describe('영상별 학습 기록 초기화', () => {
  it('과거 답안은 보존하고 현재 진도와 시도를 새로 시작한다', async () => {
    const { service, tx } = setup();

    await expect(
      service.applyAction('me', 'video', { action: 'reset' })
    ).resolves.toEqual({ ok: true });

    expect(tx.findOne).toHaveBeenCalledWith(Progress, {
      where: { userId: 'me', videoId: 'video' },
    });

    for (const entity of [SegmentState, SegmentDifficulty])
      expect(tx.delete).toHaveBeenCalledWith(entity, {
        progressId: 'my-progress',
      });

    expect(tx.update).toHaveBeenCalledWith(
      Progress,
      { id: 'my-progress' },
      { currentIndex: 0, mode: 'full', cycle: 1, scriptViewed: false }
    );

    expect(tx.delete).not.toHaveBeenCalledWith(Attempt, expect.anything());

    expect(tx.query.mock.invocationCallOrder[1]).toBeLessThan(
      tx.delete.mock.invocationCallOrder[0]
    );
  });

  it('본인 학습 목록에 없는 영상의 기록은 삭제하지 않는다', async () => {
    const { service, tx } = setup(false);

    await expect(
      service.applyAction('me', 'other-video', { action: 'reset' })
    ).rejects.toMatchObject({ status: 404 });

    expect(tx.delete).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });
});

describe('서비스 내 영상 좋아요', () => {
  it('등록된 영상에 계정별 좋아요를 중복 없이 저장한다', async () => {
    const { service, tx, insert } = setup();

    await expect(service.setLike('me', 'video', true)).resolves.toEqual({
      liked: true,
      likeCount: 3,
    });

    expect(insert.into).toHaveBeenCalledWith(VideoLike);

    expect(insert.values).toHaveBeenCalledWith([
      { userId: 'me', videoId: 'video' },
    ]);

    expect(insert.orIgnore).toHaveBeenCalled();

    expect(tx.count).toHaveBeenCalledWith(VideoLike, {
      where: { videoId: 'video' },
    });

    expect(tx.update).not.toHaveBeenCalled();
  });

  it('좋아요 취소는 본인의 선택만 삭제한다', async () => {
    const { service, tx } = setup();

    await service.setLike('me', 'video', false);

    expect(tx.delete).toHaveBeenCalledWith(VideoLike, {
      userId: 'me',
      videoId: 'video',
    });

    expect(tx.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('본인 목록에 없는 영상에는 좋아요를 남길 수 없다', async () => {
    const { service, tx } = setup(false);

    await expect(service.setLike('me', 'video', true)).rejects.toMatchObject({
      status: 404,
    });

    expect(tx.createQueryBuilder).not.toHaveBeenCalled();
  });
});
