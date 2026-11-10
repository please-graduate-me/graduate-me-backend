import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  citationAnchors,
  selectedCitationSchema,
} from './citation-contract.js';
import { anthropicSchema } from './anthropic-schema.js';
import { validateCitations } from './learning-ai.service.js';
import { normalizedExcerpt } from '../learning/source.service.js';

const source = (quote: string) => ({
  kind: 'pdf' as const,
  materialId: 'synthetic-material',
  page: 1,
  version: 7,
  language: 'th' as const,
  title: '직접 만든 태국어 인용 예제',
  quote,
});

describe('원문에 고정된 인용 계약', () => {
  it('태국어 성조·결합 문자·보이지 않는 구분자도 원문 값 그대로 공급자 enum에 둔다', () => {
    const selected = source('ฉันอ่านหนังสือ\u200bที่ห้องสมุด');
    const anchors = citationAnchors(selected);
    const schema = selectedCitationSchema(anchors);

    const wire = anthropicSchema(
      z.toJSONSchema(schema) as Record<string, unknown>
    );

    expect(anchors).toEqual([selected.quote]);

    expect(wire).toMatchObject({
      items: { properties: { quote: { enum: [selected.quote] } } },
    });

    expect(schema.safeParse([{ quote: selected.quote }]).success).toBe(true);

    expect(
      schema.safeParse([{ quote: selected.quote.replace('\u200b', '') }])
        .success
    ).toBe(false);

    expect(() =>
      validateCitations(
        { citations: [{ quote: selected.quote.replace('\u200b', '') }] },
        selected
      )
    ).toThrow();

    expect(() =>
      validateCitations({ citations: [{ quote: selected.quote }] }, selected)
    ).not.toThrow();
  });

  it('긴 선택 전체를 최대 열 조각으로 덮으며 태국어 결합 문자·이모지 경계를 끊지 않는다', () => {
    const selected = source('ก้👩‍💻ภาษาไทย '.repeat(250));
    const anchors = citationAnchors(selected);

    const boundaries = new Set(
      Array.from(
        new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(
          selected.quote
        ),
        (item) => item.index
      )
    );

    boundaries.add(selected.quote.length);
    expect(anchors.length).toBeLessThanOrEqual(10);
    expect(anchors.length).toBeGreaterThan(1);

    expect(normalizedExcerpt(anchors.join(''))).toBe(
      normalizedExcerpt(selected.quote)
    );

    let offset = 0;

    for (const quote of anchors) {
      const start = selected.quote.indexOf(quote, offset);
      const end = start + quote.length;

      expect(start).toBeGreaterThanOrEqual(offset);
      expect(boundaries.has(start)).toBe(true);
      expect(boundaries.has(end)).toBe(true);

      expect(() =>
        validateCitations({ citations: [{ quote }] }, selected)
      ).not.toThrow();

      offset = end;
    }
  });

  it('다른 문맥·번역·성조 교정 인용과 빈 인용은 계속 거부한다', () => {
    const selected = source('วันนี้ฉันกินข้าว');
    const schema = selectedCitationSchema(citationAnchors(selected));

    for (const quote of [
      '인접 페이지의 문장',
      '오늘 나는 밥을 먹는다',
      'วันนี้ฉันกินข่าว',
      '',
      '   ',
    ]) {
      expect(schema.safeParse([{ quote }]).success).toBe(false);
    }

    expect(schema.safeParse([]).success).toBe(false);

    expect(() =>
      validateCitations(
        { citations: [{ quote: '오늘 나는 밥을 먹는다' }] },
        selected
      )
    ).toThrow();
  });
});
