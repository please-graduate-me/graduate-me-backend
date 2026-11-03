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
        answer: 'x'.repeat(2001),
      }).success
    ).toBe(false);

    expect(
      actionSchema.safeParse({ action: 'navigate', index: 0, mode: 'unknown' })
        .success
    ).toBe(false);
  });
});
