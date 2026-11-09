import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { SourceService } from '../learning/source.service.js';
import type { LearningAIService } from './learning-ai.service.js';
import type { OperationService } from './operation.service.js';
import { ConversationService } from './conversation.service.js';

it.each([
  { label: '일반 문자', character: '가' },
  { label: '제어 문자', character: String.fromCharCode(0) },
])(
  '긴 대화의 근거·실패 안내와 이스케이프를 고려해 같은 최근 텍스트 예산을 전달한다: $label',
  async ({ character }) => {
    const source = {
      kind: 'pdf' as const,
      materialId: 'material',
      page: 1,
      version: 1,
      quote: 'Source quote',
      title: '자료',
      language: 'en' as const,
    };

    const history = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      role: i % 2 ? 'user' : 'assistant',
      status: i === 1 ? 'failed' : 'ready',
      text: `${i}:` + character.repeat(10000) + `#${i}`,
      citations: [{ quote: 'secret metadata'.repeat(1000) }],
      uncertainty: '불확실성'.repeat(1000),
    }));

    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        value: { related: true },
        model: 'mock',
        provider: 'anthropic',
      })
      .mockResolvedValueOnce({
        value: {
          text: '설명',
          citations: [{ quote: 'Source quote' }],
          uncertainty: '',
        },
        model: 'mock',
        provider: 'anthropic',
      });

    const db = {
      manager: {
        findOneBy: vi
          .fn()
          .mockResolvedValue({ id: 'conversation', ownerId: 'owner', source }),
        find: vi.fn().mockResolvedValue(history),
        save: vi.fn().mockResolvedValue({ id: 'new-message' }),
        insert: vi.fn(),
        update: vi.fn(),
      },
    };

    const ai = {
      ensureConfigured: vi.fn(),
      preferences: vi
        .fn()
        .mockResolvedValue({ explanationLanguage: 'ko', level: 'beginner' }),
      provider: { identity: () => ({ provider: 'anthropic', model: 'mock' }) },
      generate,
    };

    const run = vi.fn(async (_owner, _request, _task, _input, execute) =>
      execute()
    );

    const service = new ConversationService(
      db as unknown as DataSource,
      {
        context: async () => ({
          source,
          context: '문맥',
          contextDescription: '선택 원문',
        }),
      } as unknown as SourceService,
      ai as unknown as LearningAIService,
      { run } as unknown as OperationService
    );

    await service.message('owner', 'conversation', 'request', '후속 질문');
    const scope = JSON.parse(generate.mock.calls[0][6]);
    const answer = JSON.parse(generate.mock.calls[1][6]);

    expect(scope.history).toEqual(answer.history);

    expect(
      answer.history.reduce(
        (sum: number, item: { text: string }) => sum + item.text.length,
        0
      )
    ).toBeLessThanOrEqual(32000);

    expect(answer.history.at(-1).text.endsWith('#0')).toBe(true);

    expect(
      answer.history.some((item: { text: string }) => item.text.endsWith('#1'))
    ).toBe(false);

    expect(
      answer.history.every(
        (item: object) => Object.keys(item).sort().join(',') === 'role,text'
      )
    ).toBe(true);

    expect(JSON.stringify(answer.history).length).toBeLessThanOrEqual(32000);
    expect(JSON.stringify(answer)).not.toContain('secret metadata');
  }
);

describe('저장용 실패 안내', () => {
  it('HttpError의 한국어 원인을 Error.message와 응답 본문에서 동일하게 유지한다', async () => {
    const { HttpError } = await import('../common/http-error.js');
    const error = new HttpError(429, '오늘의 AI 사용 한도에 도달했습니다.');

    expect(error.message).toBe('오늘의 AI 사용 한도에 도달했습니다.');
    expect(error.getResponse()).toEqual({ error: error.message });
  });
});
