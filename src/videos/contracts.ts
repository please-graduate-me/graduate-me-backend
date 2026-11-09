import { z } from 'zod';

/** 저장과 표시에서 지원하는 학습 모드의 범위를 맞춘다. */
export const modeSchema = z.enum(['full', 'blank']);

/** 검증 스키마에서 타입을 추론해 별도 선언의 불일치를 막는다. */
export type Mode = z.infer<typeof modeSchema>;

/** 오답 표시가 알 수 없는 비교 결과를 받지 않게 한다. */
export const differenceSchema = z.object({
  kind: z.enum(['match', 'missing', 'extra', 'replace']),
  expected: z.string().optional(),
  actual: z.string().optional(),
});

/** 검증 스키마에서 타입을 추론해 별도 선언의 불일치를 막는다. */
export type Difference = z.infer<typeof differenceSchema>;

/** 채점 결과의 정답 여부와 단어별 차이를 정의한다. */
export const gradeSchema = z.object({
  correct: z.boolean(),
  differences: z.array(differenceSchema),
});

/** 검증 스키마에서 타입을 추론해 별도 선언의 불일치를 막는다. */
export type Grade = z.infer<typeof gradeSchema>;

/** 영상 등록 입력의 제한을 요청 양쪽에서 맞춘다. */
export const registerVideoSchema = z.object({
  url: z.string().max(2048),
  language: z.enum(['en', 'th']).default('en'),
  learningPurposeConfirmed: z.literal(true, {
    error: '언어 학습 목적으로 사용할 자료임을 확인해 주세요.',
  }),
});

/** 좋아요 재전송으로 상태가 반전되지 않도록 원하는 값을 받는다. */
export const videoLikeInputSchema = z.object({ liked: z.boolean() });

/** 공용 좋아요와 개인 관심 영상 표시를 별도로 변경한다. */
export const videoFavoriteInputSchema = z.object({ favorite: z.boolean() });
