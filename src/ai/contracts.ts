import { z } from 'zod';
import { sourceInputSchema, languageSchema } from '../learning/contracts.js';

/** 설명의 원문 근거와 AI 추가 예문·불확실성을 서로 구분한다. */
export const explanationPayloadSchema = z.object({
  translation: z.string().max(10000),
  meaning: z.string().max(10000),
  structure: z.string().max(10000),
  concept: z.string().max(10000),
  examples: z.array(z.string().max(2000)).max(8),
  uncertainty: z.string().max(4000),
  citations: z
    .array(z.object({ quote: z.string().trim().min(1).max(5000) }))
    .min(1)
    .max(10),
});

/** 정답·선택지·해설을 한 버전으로 검증하고 저장한다. */
export const practicePayloadSchema = z
  .object({
    type: z.enum(['choice', 'short_answer', 'free_response']),
    question: z.string().trim().min(1).max(5000),
    choices: z.array(z.string().trim().min(1).max(2000)).max(5),
    answer: z.string().trim().min(1).max(5000),
    explanation: z.string().trim().min(1).max(10000),
    hint: z.string().trim().min(1).max(2000),
    sourceQuote: z.string().trim().min(1).max(5000),
  })
  .superRefine((p, ctx) => {
    if (
      p.type === 'choice' &&
      (p.choices.length < 2 ||
        new Set(p.choices).size !== p.choices.length ||
        p.choices.filter((c) => c === p.answer).length !== 1)
    )
      ctx.addIssue({
        code: 'custom',
        message: '객관식 선택지와 단일 정답을 확인해 주세요.',
      });
    if (p.type !== 'choice' && p.choices.length)
      ctx.addIssue({
        code: 'custom',
        message: '정답형·자유 답변 문항에는 선택지를 넣지 않습니다.',
      });
  });

/** 원문 선택과 설명 언어별로 생성 요청을 고정한다. */
export const explanationInputSchema = z.object({
  requestId: z.uuid(),
  source: sourceInputSchema,
  mode: z
    .enum(['meaning', 'translation', 'structure', 'concept'])
    .default('meaning'),
  explanationLanguage: z.enum(['ko', 'en', 'th']).optional(),
  image: z
    .object({
      base64: z.string().max(5_592_408),
      mimeType: z.enum(['image/png', 'image/jpeg']),
    })
    .optional(),
});

/** 최초 자료 준비 범위를 사용자가 명시한 페이지로 제한한다. */
export const preparationSchema = z.object({
  requestId: z.uuid(),
  fromPage: z.number().int().min(1),
  toPage: z.number().int().min(1),
  explanationLanguage: z.enum(['ko', 'en', 'th']).optional(),
});

/** 저장 결과 조회는 생성 입력 없이 출처 필터만 받는다. */
export const sourceQuerySchema = z.object({
  version: z.coerce.number().int().positive().optional(),
  ocrId: z.union([z.uuid(), z.literal('none')]).optional(),
  kind: z.enum(['pdf', 'video']).optional(),
  materialId: z.string().min(1).max(128).optional(),
  videoId: z.string().min(1).max(128).optional(),
  page: z.coerce.number().int().positive().optional(),
  segmentId: z.string().min(1).max(128).optional(),
  language: languageSchema.optional(),
});

/** 개인 대화를 여는 동작 자체는 생성 요청이 아니다. */
export const conversationInputSchema = z.object({ source: sourceInputSchema });

/** 새 질문만 요청 식별자와 함께 실행한다. */
export const chatInputSchema = z.object({
  requestId: z.uuid(),
  text: z.string().trim().min(1).max(4000),
});

/** 선택 자료 또는 저장 표현을 실제 출제 근거로 지정한다. */
export const practiceGenerateSchema = z
  .object({
    requestId: z.uuid(),
    source: sourceInputSchema.optional(),
    expressionIds: z.array(z.uuid()).min(1).max(10).optional(),
    language: languageSchema,
    type: z.enum(['choice', 'short_answer', 'free_response']).default('choice'),
    count: z.number().int().min(1).max(5).default(3),
    style: z.enum(['application', 'flex']).optional(),
    skill: z.enum(['reading', 'listening']).optional(),
    explanationId: z.uuid().optional(),
  })
  .refine(
    (v) => Boolean(v.source || v.expressionIds?.length),
    '출제할 원문 또는 표현을 선택해 주세요.'
  );

/** 같은 버전의 초안·복습 제외 상태만 변경한다. */
export const exerciseStateSchema = z.object({
  version: z.number().int().positive(),
  draft: z.string().max(10000).optional(),
  excluded: z.boolean().optional(),
});

/** 힌트·정답 열람을 해당 문항 버전에 기록한다. */
export const exerciseVersionSchema = z.object({
  version: z.number().int().positive(),
});

/** 서버 채점은 요청 식별자와 당시 문제 버전에 연결한다. */
export const exerciseAnswerSchema = exerciseVersionSchema.extend({
  requestId: z.uuid(),
  answer: z.string().trim().min(1).max(10000),
});

/** 설명과 문항의 검토 범위를 명시한다. */
export const contentTargetSchema = z.object({
  kind: z.enum(['explanation', 'practice', 'segment']),
  id: z.string().min(1).max(128),
  version: z.number().int().positive(),
});

/** 새 수정본은 기대 버전과 이유를 반드시 포함한다. */
export const revisionInputSchema = z.object({
  questionId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
  reason: z.string().trim().min(1).max(5000),
});

/** 특정 버전의 검토·확인 필요 상태만 기록한다. */
export const contentReviewSchema = z.object({
  questionId: z.uuid(),
  version: z.number().int().positive(),
  status: z.enum(['verified', 'needs_review']),
  reason: z.string().trim().min(1).max(5000),
});

/** 문항 노출 변경에도 버전과 조치 사유를 남긴다. */
export const visibilityInputSchema = z.object({
  questionId: z.uuid(),
  version: z.number().int().positive(),
  visible: z.boolean(),
  reason: z.string().trim().min(1).max(5000),
});

/** 설명 출력과 근거 검증에 사용하는 정형 데이터이다. */
export type ExplanationPayload = z.infer<typeof explanationPayloadSchema>;

/** 공개 DTO와 서버 채점 데이터의 투영을 구분한다. */
export type PracticePayload = z.infer<typeof practicePayloadSchema>;

/** 실행 가능한 원문별 질의 필터이다. */
export type SourceQuery = z.infer<typeof sourceQuerySchema>;
