import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { Video } from '../database/entities/Video.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { demoYoutubeId } from './demo.js';
import { DemoController } from './demo.controller.js';
import { CatalogController } from './catalog.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';

function setup(status: string | null, segments: unknown[] = []) {
  const findOne = vi
    .fn()
    .mockResolvedValue(status ? { id: 'demo', job: { status } } : null);

  const find = vi.fn().mockResolvedValue(segments);

  const controller = new DemoController({
    manager: { findOne, find },
  } as unknown as DataSource);

  return { controller, findOne, find };
}

describe('공개 체험의 조회 범위', () => {
  it('영상 탐색 API는 로그인 뒤에만 허용한다', () => {
    expect(Reflect.getMetadata('__guards__', CatalogController)).toContain(
      AuthGuard
    );
  });

  it('지정 영상의 학습 가능한 구절 최대 열 개만 조회한다', async () => {
    const segments = [{ id: 'one', start: 10, end: 15, text: 'Hello there.' }];
    const { controller, findOne, find } = setup('ready', segments);

    expect(await controller.lesson()).toEqual({
      youtubeId: demoYoutubeId,
      status: 'ready',
      segments,
    });

    expect(findOne).toHaveBeenCalledWith(
      Video,
      expect.objectContaining({ where: { youtubeId: demoYoutubeId } })
    );

    expect(find).toHaveBeenCalledWith(Segment, {
      where: { videoId: 'demo', excluded: false },
      order: { index: 'ASC' },
      take: 10,
      select: { id: true, start: true, end: true, text: true },
    });
  });

  it.each([null, 'transcribing'])(
    '준비 전에는 빈 문장 목록을 반환한다',
    async (status) => {
      expect(await setup(status).controller.lesson()).toEqual({
        youtubeId: demoYoutubeId,
        status: 'preparing',
        segments: [],
      });
    }
  );

  it.each(['failed', 'ready'])(
    '실패하거나 학습 가능한 문장이 없으면 내부 오류를 노출하지 않는다',
    async (status) => {
      expect(await setup(status).controller.lesson()).toEqual({
        youtubeId: demoYoutubeId,
        status: 'failed',
        segments: [],
      });
    }
  );
});
