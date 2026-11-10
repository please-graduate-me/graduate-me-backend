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
  z.object({ action: z.literal('viewScript') }),
  z.object({
    action: z.literal('watchPosition'),
    position: z.number().finite().nonnegative(),
    watchMode: z.enum(['dictation', 'script']),
    watchVersion: z.string().regex(/^[a-f0-9]{64}$/),
    expectedRevision: z.number().int().min(0).max(2147483646),
    requestId: z.uuid(),
  }),
  z.object({
    action: z.literal('blankRatio'),
    ratio: z.union([z.literal(20), z.literal(40), z.literal(60)]),
  }),
  z.object({
    action: z.literal('hint'),
    segmentId: z.string(),
    sourceVersion: z.number().int().positive().optional(),
    mode: modeSchema,
  }),
  z.object({
    action: z.literal('difficulty'),
    segmentId: z.string(),
    sourceVersion: z.number().int().positive().optional(),
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
    sourceVersion: z.number().int().positive().optional(),
    mode: modeSchema,
    answer: answerSchema,
  }),
  z.object({
    action: z.literal('submit'),
    segmentId: z.string(),
    sourceVersion: z.number().int().positive().optional(),
    mode: modeSchema,
    answer: answerSchema,
    requestId: z.uuid(),
  }),
  z.object({
    action: z.enum(['reveal', 'skip']),
    segmentId: z.string(),
    sourceVersion: z.number().int().positive().optional(),
    mode: modeSchema,
  }),
]);

/** 검증 규칙과 요청 타입이 따로 변경되지 않게 한다. */
export type LearningAction = z.infer<typeof actionSchema>;
