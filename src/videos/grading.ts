import { answerLimits } from './constants.js';
import type { Mode, Difference, Grade } from './contracts.js';

/** 태국어는 단어 경계를 분절하고 영어의 기존 빈칸 단위는 유지한다. */
export function learningUnits(
  text: string,
  language: 'en' | 'th' = /[\u0e00-\u0e7f]/u.test(text) ? 'th' : 'en'
): string[] {
  return language === 'th'
    ? Array.from(
        new Intl.Segmenter('th', { granularity: 'word' }).segment(text.trim()),
        (item) => item.segment
      )
    : text.trim().split(/\s+/).filter(Boolean);
}

/** 차이 표시는 언어 문자·문장부호·공백을 제거하지 않고 분절한다. */
export function tokens(text: string): string[] {
  const locale = /[\u0e00-\u0e7f]/u.test(text) ? 'th' : 'en';

  return Array.from(
    new Intl.Segmenter(locale, { granularity: 'word' }).segment(text.trim()),
    (item) => item.segment
  );
}

/** 부분 차이는 표시하되 정답은 앞뒤 공백 정리 후 전체 일치로 판정한다. */
export function grade(expectedText: string, actualText: string): Grade {
  const expected = tokens(expectedText),
    actual = tokens(actualText);

  const matrix = Array.from(
    { length: expected.length + 1 },
    () => new Uint16Array(actual.length + 1)
  );

  for (let i = 0; i <= expected.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= actual.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= expected.length; i++)
    for (let j = 1; j <= actual.length; j++)
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + Number(expected[i - 1] !== actual[j - 1])
      );
  const differences: Difference[] = [];

  let i = expected.length,
    j = actual.length;

  while (i || j) {
    if (
      i &&
      j &&
      matrix[i][j] ===
        matrix[i - 1][j - 1] + Number(expected[i - 1] !== actual[j - 1])
    )
      differences.push({
        kind: expected[i - 1] === actual[j - 1] ? 'match' : 'replace',
        expected: expected[--i],
        actual: actual[--j],
      });
    else if (i && matrix[i][j] === matrix[i - 1][j] + 1)
      differences.push({ kind: 'missing', expected: expected[--i] });
    else differences.push({ kind: 'extra', actual: actual[--j] });
  }

  return {
    correct:
      expectedText.trim().length > 0 &&
      expectedText.trim() === actualText.trim(),
    differences: differences.reverse(),
  };
}

const priority = new Set(
  'a an the at by for from in into of on to with without about over under between during before after as i you he she it we they my your his our their am is are was were be been do does did have has had can could will would shall should may might must and or but if that than this these those'.split(
    ' '
  )
);

/** 저장된 후보와 비율로 같은 시도의 빈칸을 재현한다. */
export function blankIndices(
  text: string,
  ratio: 20 | 40 | 60 = 20,
  candidates?: number[] | null,
  language?: 'en' | 'th'
): number[] {
  const parts = learningUnits(text, language),
    eligible = parts.flatMap((word, index) =>
      /[\p{L}\p{N}]/u.test(word) ? [index] : []
    );

  const preferred = candidates
    ? candidates.filter((index) => eligible.includes(index))
    : [
        ...eligible.filter(
          (index) =>
            priority.has(parts[index].toLowerCase()) ||
            parts[index].includes("'")
        ),
        ...eligible,
      ];

  const count = Math.min(
    answerLimits.blanks,
    Math.max(1, Math.round((eligible.length * ratio) / 100)),
    new Set(preferred).size
  );

  return [...new Set(preferred)].slice(0, count).sort((a, b) => a - b);
}

/** 모드와 저장 후보를 사용해 출제한 모든 위치가 일치할 때만 정답으로 판정한다. */
export function gradeAnswer(
  text: string,
  mode: Mode,
  answer: string | string[],
  ratio: 20 | 40 | 60 = 20,
  candidates?: number[] | null,
  language?: 'en' | 'th'
): Grade {
  if (mode === 'full') return grade(text, answer as string);
  const words = learningUnits(text, language);
  const indices = blankIndices(text, ratio, candidates, language);

  const results = indices.map((index, position) =>
    grade(words[index], (answer as string[])[position] ?? '')
  );

  return {
    correct: results.length > 0 && results.every((result) => result.correct),
    differences: results.flatMap((result) => result.differences),
  };
}
