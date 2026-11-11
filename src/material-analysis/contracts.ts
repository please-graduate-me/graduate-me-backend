import { z } from 'zod';

const shortText = z.string().trim().min(1).max(1000);

/** 추출 어휘는 원문 예문과 페이지에 연결하고 개인 표현집과 구분한다. */
export const analysisWordSchema = z.object({
  term: z.string().trim().min(1).max(100),
  lemma: z.string().trim().min(1).max(100),
  partOfSpeech: z.string().trim().min(1).max(40),
  meaning: z.string().trim().min(1).max(300),
  example: z.string().trim().min(1).max(500),
});

/** 문서 개요는 처리된 페이지와 실제 어휘 식별자만 인용한다. */
export const analysisOverviewSchema = z.object({
  documentType: shortText,
  introduction: z.string().trim().min(1).max(3000),
  summary: z.array(shortText).min(1).max(10),
  keyPoints: z
    .array(
      z.object({
        text: shortText,
        pages: z.array(z.number().int().min(1).max(30)).min(1).max(30),
      })
    )
    .max(15),
  wordIds: z.array(z.string().min(1).max(40)).max(50),
});

/** 페이지 전체 번역의 누락 여부를 명시하고 잘린 출력을 완료로 저장하지 않는다. */
export const analysisPageOutputSchema = z.object({
  complete: z.boolean(),
  blank: z.boolean(),
  sourceText: z.string().max(60000),
  translation: z.string().max(60000),
  pageSummary: shortText,
  words: z.array(analysisWordSchema).max(50),
  warnings: z.array(shortText).max(10),
  overview: analysisOverviewSchema,
});

/** 완료된 페이지를 보존하면서 실패한 페이지만 명시적으로 재요청한다. */
export const analysisRetrySchema = z.object({
  version: z.number().int().positive(),
  requestId: z.uuid(),
});

/** 원본 버전에 대응하는 저장 분석만 조회한다. */
export const analysisQuerySchema = z.object({
  version: z.coerce.number().int().positive(),
});

/** 페이지 처리 상태와 생성 당시 모델을 함께 보존한다. */
export interface AnalysisPage {
  page: number;
  status: 'queued' | 'ready' | 'failed';
  result: z.infer<typeof analysisPageOutputSchema> | null;
  error: string | null;
  provider: string | null;
  model: string | null;
}
