import { z } from 'zod';
import { sourceInputSchema } from '../learning/contracts.js';

/** 일반 글도 공개 대상을 명시하고 원본 전체 대신 선택한 발췌만 선택적으로 첨부한다. */
export const communityPostSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(10000),
    language: z.enum(['en', 'th']),
    visibility: z.enum(['public', 'accounts']),
    allowedUserIds: z.array(z.string().min(1).max(128)).max(100).default([]),
    source: sourceInputSchema.optional(),
    taggedHelperIds: z.array(z.string().min(1).max(128)).max(20).default([]),
  })
  .refine(
    (v) => v.visibility !== 'accounts' || v.allowedUserIds.length > 0,
    '계정 전용 글에는 수신자를 지정해 주세요.'
  );

/** 공개 글 목록은 언어·검색·팔로우 필터와 페이지 범위를 제한한다. */
export const communityQuerySchema = z.object({
  language: z.enum(['en', 'th']).optional(),
  q: z.string().max(100).default(''),
  following: z.enum(['true', 'false']).default('false'),
  tagged: z.enum(['true', 'false']).default('false'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** 댓글은 별도의 개인 기록이나 AI 대화 전체를 자동 첨부하지 않는다. */
export const communityCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

/** 추천과 팔로우는 중복 생성 대신 원하는 상태로 수렴한다. */
export const communityReactionSchema = z.object({ active: z.boolean() });

/** 일반 게시물 신고는 학습 자료의 정답·설명 오류 신고와 분리한다. */
export const communityReportSchema = z.object({
  reason: z.string().trim().min(1).max(5000),
});
