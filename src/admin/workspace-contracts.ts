import { z } from 'zod';
import { languageSchema } from '../learning/contracts.js';
import { workspaceQuerySchema } from '../learning/contracts.js';

/** 질문의 상태와 기간도 페이지를 나누기 전에 서버 권한 범위 전체에 적용한다. */
export const questionListQuerySchema = workspaceQuerySchema.extend({
  status: z.enum(['all', 'waiting', 'answered', 'review']).default('all'),
  period: z.enum(['all', '7', '30']).default('all'),
});

/** 학생 목록 계약과 분리한 관리자 질문 검색 조건이다. */
export type QuestionListQuery = z.infer<typeof questionListQuerySchema>;

/** 검토·감사 이력은 검색 후 페이지를 나눠 과거 기록도 조회하게 한다. */
export const historyQuerySchema = workspaceQuerySchema.extend({
  status: z.string().trim().max(30).default('all'),
  kind: z.enum(['all', 'report', 'review_request']).default('all'),
  period: z.enum(['all', '7', '30']).default('all'),
});

/** 이력 검색은 앱의 표시 조건과 서버 조회 조건을 함께 유지한다. */
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

/** 초안과 내부 메모는 답변 게시 요청과 별도로 검증한다. */
export const draftInputSchema = z.object({
  draft: z.string().max(10_000).optional(),
  internalNote: z.string().max(10_000).optional(),
});

/** 배정 해제는 명시적인 null로만 수행한다. */
export const assignInputSchema = z.object({
  assigneeId: z.string().min(1).max(128).nullable(),
});

/** 검토 대상과 버전을 함께 남겨 자료 전체 검토로 오인하지 않게 한다. */
export const reviewInputSchema = z.object({
  scope: z.enum(['source', 'explanation', 'question']),
  version: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(1).max(5000),
  target: z
    .object({
      kind: z.enum(['explanation', 'practice', 'segment']),
      id: z.string().min(1).max(128),
      version: z.number().int().positive(),
    })
    .optional(),
});

/** 처리 사유 없는 검토 종료를 막는다. */
export const resolutionInputSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
  resolution: z.string().trim().min(1).max(5000),
});

/** 도우미의 자료와 수행 권한을 각각 지정한다. */
export const helperInputSchema = z.object({
  email: z
    .email()
    .max(320)
    .transform((v) => v.toLowerCase()),
  languages: z
    .array(languageSchema)
    .max(2)
    .refine((v) => new Set(v).size === v.length),
  materialIds: z
    .array(z.string().min(1).max(128))
    .max(200)
    .refine((v) => new Set(v).size === v.length),
  canReview: z.boolean(),
  canRequestEdit: z.boolean(),
  active: z.boolean(),
  canEdit: z.boolean().optional(),
});
