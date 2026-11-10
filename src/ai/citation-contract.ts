import { z } from 'zod';
import type { LearningSource } from '../learning/contracts.js';
import { HttpError } from '../common/http-error.js';

/** 선택 원문의 문자 값을 바꾸지 않고 전체 범위를 덮는 최대 열 개의 인용 후보를 만든다. */
export function citationAnchors(
  source: Pick<LearningSource, 'quote' | 'language'>
) {
  if (source.quote.length <= 500 && source.quote.trim()) return [source.quote];

  const graphemes = Array.from(
    new Intl.Segmenter(source.language, { granularity: 'grapheme' }).segment(
      source.quote
    )
  );

  const size = Math.max(1, Math.ceil(graphemes.length / 10));
  const anchors: string[] = [];

  // 태국어 결합 문자와 성조를 자르거나 다시 정규화하지 않고 실제 원문의 연속 구간만 복사한다.
  for (let index = 0; index < graphemes.length; index += size) {
    const end = graphemes[index + size]?.index ?? source.quote.length;
    const quote = source.quote.slice(graphemes[index].index, end).trim();

    if (quote) anchors.push(quote);
  }

  if (!anchors.length)
    throw new HttpError(400, '인용할 선택 원문을 확인해 주세요.');

  return anchors;
}

/** 문맥·번역·표기 교정 문장을 모델이 임의 인용으로 생성하지 않도록 원문 후보만 허용한다. */
export function selectedCitationSchema(anchors: string[]) {
  return z
    .array(
      z.object({
        quote: z
          .enum(anchors)
          .describe(
            '선택 원문에서 제공한 인용 후보 하나를 글자 수정 없이 그대로 복사합니다.'
          ),
      })
    )
    .min(1)
    .max(10);
}

/** 인접 문맥과 이미지 관찰은 이해 보조이며 선택 원문 인용과 혼동하지 않게 한다. */
export const citationInstruction =
  '선택 원문은 source.quote입니다. citations[].quote는 allowedCitationQuotes 중 하나를 글자 값 그대로 복사하세요. 번역·요약·태국어 성조나 결합 문자·띄어쓰기·문장부호 교정으로 인용을 바꾸지 마세요. context는 이해를 돕는 주변 문맥이며 선택 원문 밖의 문장은 인용할 수 없습니다. 이미지에만 보이는 문장도 선택한 문자 원문의 인용으로 제시하지 마세요.';
