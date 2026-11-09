import { describe, expect, it } from 'vitest';
import { actionSchema } from './actions.js';

describe('학습 요청 검증', () => {
  it('답안 제출에는 재전송 식별자가 필요하다', () => {
    expect(
      actionSchema.safeParse({
        action: 'submit',
        segmentId: 'segment',
        mode: 'full',
        answer: 'hello',
      }).success
    ).toBe(false);
  });

  it('답안 길이와 모드 값을 검증한다', () => {
    expect(
      actionSchema.safeParse({
        action: 'draft',
        segmentId: 'segment',
        mode: 'full',
        answer: 'x'.repeat(5001),
      }).success
    ).toBe(false);

    expect(
      actionSchema.safeParse({ action: 'navigate', index: 0, mode: 'unknown' })
        .success
    ).toBe(false);
  });

  it('구절 동작은 선택적 원문 버전을 보존하고 잘못된 버전은 거부한다', () => {
    for (const action of ['draft', 'submit', 'reveal', 'skip', 'hint']) {
      const input = {
        action,
        segmentId: 'segment',
        mode: 'full',
        answer: 'hello',
        requestId: '00000000-0000-4000-8000-000000000001',
        sourceVersion: 2,
      };

      expect(actionSchema.parse(input)).toMatchObject({ sourceVersion: 2 });

      expect(
        actionSchema.safeParse({ ...input, sourceVersion: 0 }).success
      ).toBe(false);

      expect(
        actionSchema.safeParse({ ...input, sourceVersion: 1.5 }).success
      ).toBe(false);
    }
  });
});
