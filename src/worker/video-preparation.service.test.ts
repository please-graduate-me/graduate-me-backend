import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { UsageService } from '../ai/usage.service.js';
import type { ProviderService } from '../ai/provider.service.js';
import { VideoPreparationService } from './video-preparation.service.js';

describe('영상의 독립적인 후속 준비', () => {
  it('번역 실패가 빈칸 후보 준비를 막지 않고 조회용 결과만 저장한다', async () => {
    const video = {
      id: 'v',
      language: 'en',
      ownerId: 'u',
      analysisVersion: 'v1',
      translationStatus: 'pending',
      blankStatus: 'pending',
    };

    const segments = [{ id: 's', index: 0, text: 'Hello world.', version: 1 }];
    const updates: unknown[] = [];

    const manager = {
      findOneByOrFail: vi.fn().mockResolvedValue(video),
      find: vi.fn().mockResolvedValue(segments),
      update: vi.fn(async (_entity, where, patch) => {
        const key =
          'translationStatus' in where ? 'translationStatus' : 'blankStatus';

        if (key in where && video[key as 'blankStatus'] !== where[key])
          return { affected: 0 };
        Object.assign(video, patch);

        return { affected: 1 };
      }),
    };

    const tx = {
      find: vi.fn().mockResolvedValue(segments),
      update: vi.fn(async (...args) => {
        updates.push(args);
      }),
    };

    const db = {
      manager,
      transaction: async (run: (value: typeof tx) => Promise<unknown>) =>
        run(tx),
    };

    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error('번역 공급자 실패'))
      .mockResolvedValueOnce({
        text: JSON.stringify({ segments: [{ index: 0, candidates: [1, 0] }] }),
        inputTokens: 10,
        outputTokens: 5,
      });

    const execute = vi.fn(async (_input, run) => (await run()).value);

    const service = new VideoPreparationService(
      db as unknown as DataSource,
      {
        generate,
        identity: () => ({
          provider: 'naver',
          model: 'HCX-007',
          configured: true,
        }),
      } as unknown as ProviderService,
      { execute } as unknown as UsageService
    );

    await service.prepare('v', new AbortController().signal);
    expect(video.translationStatus).toBe('failed');
    expect(video.blankStatus).toBe('ready');
    expect(generate).toHaveBeenCalledTimes(2);

    expect(updates).toContainEqual(
      expect.arrayContaining([
        expect.objectContaining({ blankCandidates: [1, 0] }),
      ])
    );

    await service.prepare('v', new AbortController().signal);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
