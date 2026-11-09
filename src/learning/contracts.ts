import { z } from 'zod';

/** 원문 언어를 지원 범위로 제한한다. */
export const languageSchema = z.enum(['en', 'th']);

/** 원문 접근 권한과 발췌를 서버에서 재검증하기 위한 입력이다. */
export const sourceInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pdf'),
    materialId: z.string().uuid(),
    page: z.number().int().min(1).max(200),
    quote: z.string().trim().min(1).max(5000),
  }),
  z.object({
    kind: z.literal('video'),
    videoId: z.string().min(1).max(128),
    segmentId: z.string().min(1).max(128),
    quote: z.string().trim().min(1).max(5000),
  }),
]);

/** 앱 사이에 구현을 공유하지 않고 API에서만 원문 식별자를 전달한다. */
export type SourceInput = z.infer<typeof sourceInputSchema>;

/** 저장 당시의 원문 위치와 발췌를 보존한다. */
export type LearningSource = SourceInput & {
  title: string;
  language: 'en' | 'th';
  start?: number;
  end?: number;
  youtubeId?: string;
};

/** PDF 원본과 브라우저에서 추출한 페이지 텍스트의 크기를 제한한다. */
export const materialInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  language: languageSchema,
  filename: z.string().trim().min(1).max(200),
  contentBase64: z.string().min(8).max(13_981_016),
  pages: z
    .array(z.string().max(50_000))
    .min(1)
    .max(200)
    .refine(
      (pages) =>
        pages.reduce((total, page) => total + page.length, 0) <= 2_000_000
    ),
});

/** 자료의 개인 메모와 마지막 읽은 위치만 변경한다. */
export const materialUpdateSchema = z.object({
  currentPage: z.number().int().min(1).max(200).optional(),
  memo: z.string().max(20_000).optional(),
});

/** 저장 표현은 원문과 함께 보존한다. */
export const expressionInputSchema = z.object({
  source: sourceInputSchema,
  text: z.string().trim().min(1).max(1000),
  meaning: z.string().trim().max(5000).default(''),
  note: z.string().max(5000).default(''),
});

/** 표현의 개인 뜻과 메모를 편집한다. */
export const expressionUpdateSchema = z.object({
  meaning: z.string().trim().max(5000).optional(),
  note: z.string().max(5000).optional(),
});

/** 질문에 공유할 원문과 공개할 본문만 받는다. */
export const questionInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  source: sourceInputSchema,
  assigneeId: z.string().min(1).max(128).optional(),
});

/** 질문과 답변 본문의 공통 길이를 제한한다. */
export const messageInputSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
});

/** 자가점검과 자동 채점을 구분해 연습 당시 내용을 보존한다. */
export const practiceInputSchema = z.object({
  expressionId: z.string().uuid(),
  answer: z.string().max(5000),
  correct: z.boolean(),
  mode: z.literal('self'),
});

/** 관리 목록을 한 번에 과도하게 조회하지 않게 한다. */
export const workspaceQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

/** 목록 조건의 검증 결과를 서비스에서 사용한다. */
export type WorkspaceQuery = z.infer<typeof workspaceQuerySchema>;

/** 담당 도우미 목록은 현재 언어와 원문 범위로 제한한다. */
export const recipientsQuerySchema = z.object({
  language: languageSchema,
  materialId: z.string().min(1).max(128).optional(),
});
