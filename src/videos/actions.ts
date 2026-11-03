import { answerLimits } from './constants.js';
import { z } from 'zod';
import { modeSchema } from './contracts.js';

const answerSchema = z.union([
  z.string().max(answerLimits.full),
  z.array(z.string().max(answerLimits.blank)).max(answerLimits.blanks),
]);

/** 지원하지 않는 학습 동작과 잘못된 입력을 처리 전에 거부한다. */
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reset') }),
  z.object({
    action: z.literal('difficulty'),
    segmentId: z.string(),
    marked: z.boolean(),
  }),
  z.object({
    action: z.literal('navigate'),
    index: z.number().int().min(0),
    mode: modeSchema,
  }),
  z.object({
    action: z.literal('draft'),
    segmentId: z.string(),
    mode: modeSchema,
    answer: answerSchema,
  }),
  z.object({
    action: z.literal('submit'),
    segmentId: z.string(),
    mode: modeSchema,
    answer: answerSchema,
    requestId: z.uuid(),
  }),
  z.object({
    action: z.enum(['reveal', 'skip']),
    segmentId: z.string(),
    mode: modeSchema,
  }),
]);

/** 검증 규칙과 요청 타입이 따로 변경되지 않게 한다. */
export type LearningAction = z.infer<typeof actionSchema>;
