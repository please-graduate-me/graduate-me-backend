import { z } from 'zod';

/** OCR은 저장된 원본의 한 버전과 한 페이지만 명시적으로 처리한다. */
export const ocrInputSchema = z.object({
  requestId: z.uuid(),
  version: z.number().int().positive(),
  page: z.number().int().min(1).max(200),
});

/** OCR 조회는 생성 없이 원본 버전과 페이지만 선택한다. */
export const ocrQuerySchema = z.object({
  version: z.coerce.number().int().positive(),
  page: z.coerce.number().int().min(1).max(200),
});

/** 원본 표시 영역에 맞춘 인식 텍스트와 신뢰도를 보존한다. */
export interface OcrField {
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  confidence: number | null;
  lineBreak: boolean;
}

/** 공급자가 실제로 반환한 인식 결과만 저장한다. */
export interface OcrResult {
  text: string;
  fields: OcrField[];
  width: number;
  height: number;
  lowConfidenceCount: number;
}

/** 인식 공급자의 실제 사용량은 페이지 결과와 분리해 한 번만 집계한다. */
export interface OcrProviderResult {
  result: OcrResult;
  provider: 'naver' | 'anthropic';
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** 공급자별 지원 언어와 생성 모델을 설정 변경 전에 확인한다. */
export interface OcrProviderIdentity {
  provider: 'naver' | 'anthropic';
  model: string;
  configured: boolean;
  supportedLanguages: readonly ('en' | 'th')[];
}
