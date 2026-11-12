import { describe, expect, it } from 'vitest';
import { growthCalendar, growthLevel } from './policy.js';
import { reviewRewardTarget } from './rewards.js';

describe('한국 시간의 학습 성장 경계', () => {
  it('UTC 일요일 오후에 한국의 월요일 주간으로 전환한다', () => {
    expect(growthCalendar(new Date('2026-11-08T14:59:59Z'))).toEqual({
      day: '2026-11-08',
      weekStart: '2026-11-02',
    });

    expect(growthCalendar(new Date('2026-11-08T15:00:00Z'))).toEqual({
      day: '2026-11-09',
      weekStart: '2026-11-09',
    });
  });

  it('누적 100 XP 경계에서 레벨이 바뀌고 다음 진행률은 0부터 시작한다', () => {
    expect(growthLevel(99)).toEqual({
      level: 1,
      levelXp: 99,
      levelTarget: 100,
    });

    expect(growthLevel(100)).toEqual({
      level: 2,
      levelXp: 0,
      levelTarget: 100,
    });
  });

  it('표현 ID와 출처 버전·표기 차이로 동일 표현 보상을 우회하지 못한다', () => {
    const source = {
      kind: 'pdf',
      materialId: 'material',
      page: 3,
      version: 1,
      title: '제목',
      quote: 'Learning opens doors.',
      language: 'en',
    } as const;

    expect(reviewRewardTarget(source, ' Opens   Doors ')).toBe(
      reviewRewardTarget({ ...source, version: 2 }, 'opens doors')
    );

    expect(reviewRewardTarget(source, 'opens doors')).not.toBe(
      reviewRewardTarget({ ...source, page: 4 }, 'opens doors')
    );
  });
});
