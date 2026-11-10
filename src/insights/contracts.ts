import { z } from 'zod';

/** 분석 기간과 학습 언어를 명시해 서로 다른 언어의 결과를 섞지 않는다. */
export const insightQuerySchema = z.object({
  language: z.enum(['en', 'th']).default('en'),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

/** 관심 없음도 계정별로 저장해 추천 후보에서 제외한다. */
export const recommendationFeedbackSchema = z.object({
  interested: z.boolean(),
});

/** 실제 노출·선택 이벤트는 요청 식별자로 중복 전송을 구분한다. */
export const recommendationEventSchema = z.object({
  requestId: z.uuid(),
  action: z.enum(['shown', 'selected']),
});
