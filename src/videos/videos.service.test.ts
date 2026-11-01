import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service.js';
import { VideosService } from './videos.service.js';

function setup(ownsVideo = true) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    progress: {
      findUnique: vi
        .fn()
        .mockResolvedValue(ownsVideo ? { id: 'my-progress' } : null),
      update: vi.fn().mockResolvedValue({}),
    },
    job: { findUnique: vi.fn().mockResolvedValue({ status: 'ready' }) },
    attempt: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    segmentState: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  const db = {
    $transaction: async (
      operation: (transaction: typeof tx) => Promise<unknown>
    ) => operation(tx),
  };
  return { tx, service: new VideosService(db as unknown as PrismaService) };
}

describe('영상별 학습 기록 초기화', () => {
  it('본인 영상의 두 모드 기록을 지우고 첫 구절과 기본 모드로 돌아간다', async () => {
    const { service, tx } = setup();
    await expect(
      service.applyAction('me', 'video', { action: 'reset' })
    ).resolves.toEqual({ ok: true });
    expect(tx.progress.findUnique).toHaveBeenCalledWith({
      where: { userId_videoId: { userId: 'me', videoId: 'video' } },
    });
    expect(tx.attempt.deleteMany).toHaveBeenCalledWith({
      where: { progressId: 'my-progress' },
    });
    expect(tx.segmentState.deleteMany).toHaveBeenCalledWith({
      where: { progressId: 'my-progress' },
    });
    expect(tx.progress.update).toHaveBeenCalledWith({
      where: { id: 'my-progress' },
      data: { currentIndex: 0, mode: 'full' },
    });
    expect(tx.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.attempt.deleteMany.mock.invocationCallOrder[0]
    );
  });

  it('본인 학습 목록에 없는 영상의 기록은 삭제하지 않는다', async () => {
    const { service, tx } = setup(false);
    await expect(
      service.applyAction('me', 'other-video', { action: 'reset' })
    ).rejects.toMatchObject({
      status: 404,
      response: { error: '학습 영상을 찾을 수 없습니다.' },
    });
    expect(tx.attempt.deleteMany).not.toHaveBeenCalled();
    expect(tx.segmentState.deleteMany).not.toHaveBeenCalled();
    expect(tx.progress.update).not.toHaveBeenCalled();
  });
});
