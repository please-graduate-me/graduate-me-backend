import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { LearningHistoryService } from '../ai/learning-history.service.js';
import type { LearningAIService } from '../ai/learning-ai.service.js';
import type { OperationService } from '../ai/operation.service.js';
import { PersonalizationService } from './personalization.service.js';

function fixture() {
  const evidence = [
    {
      id: 'expression:1',
      kind: 'saved_expression',
      text: '조건문',
      source: {},
    },
  ];

  const history = {
    collect: vi.fn().mockResolvedValue({ evidence, fingerprint: 'first' }),
  };

  const analysis = {
    summary: {
      text: '조건문 표현을 저장했습니다.',
      evidenceIds: ['expression:1'],
    },
    focusAreas: [{ text: '조건문 복습', evidenceIds: ['expression:1'] }],
    recommendations: [
      {
        videoId: 'video',
        reason: '조건문 발췌가 있습니다.',
        evidenceIds: ['expression:1'],
      },
    ],
  };

  const ai = {
    ensureConfigured: vi.fn(),
    provider: { identity: () => ({ provider: 'naver', model: 'mock' }) },
    preferences: vi
      .fn()
      .mockResolvedValue({ level: 'beginner', interests: [] }),
    generate: vi
      .fn()
      .mockResolvedValue({ value: analysis, provider: 'naver', model: 'mock' }),
  };

  const find = vi.fn().mockResolvedValue([]);

  const operations = {
    run: vi.fn(
      async (
        _owner: string,
        _id: string,
        _task: string,
        _input: unknown,
        run: () => Promise<unknown>
      ) => run()
    ),
  };

  const service = new PersonalizationService(
    { manager: { find } } as unknown as DataSource,
    history as unknown as LearningHistoryService,
    ai as unknown as LearningAIService,
    operations as unknown as OperationService
  );

  const candidates = [
    {
      id: 'video',
      title: '조건문',
      category: null,
      sampleText: 'If you study, you learn.',
    },
  ];

  return { service, history, ai, find, analysis, candidates };
}

describe('누적 기록 AI 개인화의 근거·조회 경계', () => {
  it('현재 기록과 후보 자료를 전달하고 저장 결과 조회에서는 모델을 호출하지 않는다', async () => {
    const f = fixture();

    const result = await f.service.generate(
      'owner',
      'en',
      'request',
      f.candidates
    );

    expect(f.history.collect).toHaveBeenCalledWith('owner', 'en');

    const payload = JSON.parse(
      (f.ai.generate.mock.calls[0] as unknown[])[6] as string
    );

    expect(payload.history[0].id).toBe('expression:1');
    expect(payload.candidates).toEqual(f.candidates);
    f.find.mockResolvedValue([{ result }]);

    expect(await f.service.latest('owner', 'en', f.candidates)).toMatchObject({
      evidenceCount: 1,
    });

    expect(f.ai.generate).toHaveBeenCalledTimes(1);

    expect(f.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        where: {
          ownerId: 'owner',
          task: 'learning_personalization',
          status: 'succeeded',
        },
      })
    );
  });

  it.each(['evidence', 'candidate', 'duplicate'])(
    '허구의 참조나 중복 추천을 거부한다: %s',
    async (kind) => {
      const f = fixture();

      if (kind === 'evidence') f.analysis.summary.evidenceIds = ['unknown'];
      if (kind === 'candidate')
        f.analysis.recommendations[0].videoId = 'private-video';
      if (kind === 'duplicate')
        f.analysis.recommendations.push(f.analysis.recommendations[0]);

      await expect(
        f.service.generate('owner', 'en', 'request', f.candidates)
      ).rejects.toMatchObject({ status: 502 });
    }
  );

  it('기록·설정·후보가 바뀐 저장 분석은 재사용하지 않는다', async () => {
    const f = fixture();

    const result = await f.service.generate(
      'owner',
      'en',
      'request',
      f.candidates
    );

    f.find.mockResolvedValue([{ result }]);
    expect(await f.service.latest('owner', 'th', f.candidates)).toBeNull();
    expect(await f.service.latest('owner', 'en', [])).toBeNull();
    f.ai.preferences.mockResolvedValue({ level: 'advanced', interests: [] });
    expect(await f.service.latest('owner', 'en', f.candidates)).toBeNull();

    f.history.collect.mockResolvedValue({
      evidence: [],
      fingerprint: 'deleted',
    });

    expect(await f.service.latest('owner', 'en', f.candidates)).toBeNull();
    expect(f.ai.generate).toHaveBeenCalledTimes(1);
  });

  it('기록이 없거나 생성 중 바뀌면 분석을 확정하지 않는다', async () => {
    const f = fixture();

    f.history.collect.mockResolvedValueOnce({
      evidence: [],
      fingerprint: 'empty',
    });

    await expect(
      f.service.generate('owner', 'en', 'empty', f.candidates)
    ).rejects.toMatchObject({ status: 400 });

    expect(f.ai.generate).not.toHaveBeenCalled();

    f.history.collect
      .mockResolvedValueOnce({
        evidence: [{ id: 'expression:1' }],
        fingerprint: 'old',
      })
      .mockResolvedValueOnce({ evidence: [], fingerprint: 'new' });

    await expect(
      f.service.generate('owner', 'en', 'changed', f.candidates)
    ).rejects.toMatchObject({ status: 409 });
  });
});
