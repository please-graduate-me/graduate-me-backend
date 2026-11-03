import { describe, expect, it } from 'vitest';
import { learningSettingsSchema } from './settings.js';

describe('계정 학습 옵션 계약', () => {
  const settings = {
    autoReplay: true,
    replayDelay: 1,
    replayCount: null,
    playbackRate: 1,
  };

  it('지원하는 속도와 반복 설정을 받는다', () => {
    for (const playbackRate of [0.5, 0.75, 1, 1.25, 1.5])
      expect(
        learningSettingsSchema.parse({ ...settings, playbackRate }).playbackRate
      ).toBe(playbackRate);

    expect(
      learningSettingsSchema.parse({
        ...settings,
        replayDelay: 10,
        replayCount: 10,
      }).replayCount
    ).toBe(10);
  });

  it('잘못된 속도와 무한히 짧은 반복 간격을 거부한다', () => {
    for (const patch of [
      { autoReplay: 'true' },
      { playbackRate: 2 },
      { replayDelay: 0 },
      { replayDelay: 1.5 },
      { replayCount: 0 },
      { replayCount: 11 },
    ])
      expect(
        learningSettingsSchema.safeParse({ ...settings, ...patch }).success
      ).toBe(false);
  });
});
