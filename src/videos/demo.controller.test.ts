import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { demoYoutubeId } from '@graduate-me/shared';
import { DemoController } from './demo.controller.js';
import { CatalogController } from './catalog.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { PrismaService } from '../database/prisma.service.js';

function setup(value: unknown) {
  const findUnique = vi.fn().mockResolvedValue(value);

  const controller = new DemoController({
    video: { findUnique },
  } as unknown as PrismaService);

  return { controller, findUnique };
}

describe('공개 체험의 조회 범위', () => {
  it('영상 탐색 API는 로그인 뒤에만 허용한다', () => {
    expect(Reflect.getMetadata('__guards__', CatalogController)).toContain(
      AuthGuard
    );
  });

  it('지정 영상의 학습 가능한 구절 다섯 개만 조회한다', async () => {
    const segments = [{ id: 'one', start: 10, end: 15, text: 'Hello there.' }];

    const { controller, findUnique } = setup({
      job: { status: 'ready' },
      segments,
    });

    expect(await controller.lesson()).toEqual({
      youtubeId: demoYoutubeId,
      status: 'ready',
      segments,
    });

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { youtubeId: demoYoutubeId },
        select: expect.objectContaining({
          segments: {
            where: { excluded: false },
            orderBy: { index: 'asc' },
            take: 5,
            select: { id: true, start: true, end: true, text: true },
          },
        }),
      })
    );
  });

  it.each([null, { job: { status: 'transcribing' }, segments: [] }])(
    '준비 전에는 빈 문장 목록을 반환한다',
    async (value) => {
      expect(await setup(value).controller.lesson()).toEqual({
        youtubeId: demoYoutubeId,
        status: 'preparing',
        segments: [],
      });
    }
  );

  it.each(['failed', 'ready'])(
    '실패하거나 학습 가능한 문장이 없으면 내부 오류를 노출하지 않는다',
    async (status) => {
      expect(
        await setup({
          job: { status, errorMessage: 'internal' },
          segments: [],
        }).controller.lesson()
      ).toEqual({ youtubeId: demoYoutubeId, status: 'failed', segments: [] });
    }
  );
});
