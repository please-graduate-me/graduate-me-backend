import { z } from 'zod';

/** 학습 옵션은 영상 대신 계정에 저장한다. */
export const learningSettingsSchema = z.object({
  autoReplay: z.boolean(),
  replayDelay: z.number().int().min(1).max(10),
  replayCount: z.number().int().min(1).max(10).nullable(),
  playbackRate: z.union([
    z.literal(0.5),
    z.literal(0.75),
    z.literal(1),
    z.literal(1.25),
    z.literal(1.5),
  ]),
});

/** 설정 요청과 응답의 타입이 검증 규칙과 같게 유지한다. */
export type LearningSettings = z.infer<typeof learningSettingsSchema>;
