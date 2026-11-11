import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { MaterialAnalysis } from '../database/entities/MaterialAnalysis.entity.js';
import { analysisPageOutputSchema } from './contracts.js';
import { validateAnalysisPage } from './material-analysis.processor.js';

function output(): z.infer<typeof analysisPageOutputSchema> {
  return {
    complete: true,
    blank: false,
    sourceText: 'Learning opens doors.',
    translation: '배움은 문을 엽니다.',
    pageSummary: '배움의 가치',
    words: [
      {
        term: 'Learning',
        lemma: 'learn',
        partOfSpeech: '명사',
        meaning: '배움',
        example: 'Learning opens doors.',
      },
    ],
    warnings: [],
    overview: {
      documentType: '강의안',
      introduction: '배움에 관한 자료',
      summary: ['배움은 기회로 이어집니다.'],
      keyPoints: [{ text: '배움의 가치', pages: [1] }],
      wordIds: ['1:0'],
    },
  };
}

describe('PDF 전체 정리의 완료·출처 검증', () => {
  const row = { pages: [] } as unknown as MaterialAnalysis;

  it('실제 페이지의 단어와 처리된 페이지 인용만 허용한다', () => {
    expect(() => validateAnalysisPage(row, 1, output())).not.toThrow();
    const invented = output();

    invented.words[0].example = '원문에 없는 예문';
    expect(() => validateAnalysisPage(row, 1, invented)).toThrow('원문');
    const future = output();

    future.overview.keyPoints[0].pages = [30];
    expect(() => validateAnalysisPage(row, 1, future)).toThrow('출처');
    const unknown = output();

    unknown.overview.wordIds = ['1:99'];
    expect(() => validateAnalysisPage(row, 1, unknown)).toThrow('출처');
  });

  it('불완전 번역과 빈 페이지의 모순을 완료로 표시하지 않는다', () => {
    expect(() =>
      validateAnalysisPage(row, 1, { ...output(), complete: false })
    ).toThrow('전체');

    expect(() =>
      validateAnalysisPage(row, 1, { ...output(), translation: '' })
    ).toThrow('전체');

    expect(() =>
      validateAnalysisPage(row, 1, { ...output(), blank: true })
    ).toThrow('빈 페이지');

    const blank = {
      ...output(),
      blank: true,
      sourceText: '',
      translation: '',
      words: [],
      overview: { ...output().overview, wordIds: [] },
    };

    expect(() => validateAnalysisPage(row, 1, blank)).not.toThrow();
  });
});
