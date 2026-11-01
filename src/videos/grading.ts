import { answerLimits } from '@graduate-me/shared';
import type { Mode, Difference, Grade } from '@graduate-me/shared';
/** 대소문자와 문장부호 차이가 채점 결과를 바꾸지 않게 한다. */
export function tokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) ?? []
  );
}
/** 누락과 추가를 구분해 학습자가 수정할 부분을 알 수 있게 한다. */
export function grade(expectedText: string, actualText: string): Grade {
  const expected = tokens(expectedText),
    actual = tokens(actualText);
  // 단어의 삽입과 삭제를 구분해야 이후 단어까지 오답으로 밀리지 않는다.
  const matrix = Array.from({ length: expected.length + 1 }, () =>
    new Array<number>(actual.length + 1).fill(0)
  );
  for (let i = 0; i <= expected.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= actual.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= expected.length; i++)
    for (let j = 1; j <= actual.length; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1)
      );
    }
  const differences: Difference[] = [];
  let i = expected.length,
    j = actual.length;
  while (i || j) {
    if (
      i &&
      j &&
      matrix[i][j] ===
        matrix[i - 1][j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1)
    ) {
      differences.push({
        kind: expected[i - 1] === actual[j - 1] ? 'match' : 'replace',
        expected: expected[--i],
        actual: actual[--j],
      });
    } else if (i && matrix[i][j] === matrix[i - 1][j] + 1)
      differences.push({ kind: 'missing', expected: expected[--i] });
    else differences.push({ kind: 'extra', actual: actual[--j] });
  }
  return {
    correct:
      matrix[expected.length][actual.length] === 0 && expected.length > 0,
    differences: differences.reverse(),
  };
}
const priority = new Set(
  'a an the at by for from in into of on onto to with without about over under through between among during before after as i you he she it we they me him her us them my your his our their am is are was were be been being do does did have has had can could will would shall should may might must and or but if that than this these those'.split(
    ' '
  )
);
/** 같은 구절의 빈칸이 재접속이나 채점 시 달라지지 않게 한다. */
export function blankIndices(text: string): number[] {
  const parts = text.trim().split(/\s+/);
  const eligible = parts.flatMap((word, index) =>
    tokens(word).length ? [index] : []
  );
  const preferred = eligible.filter((index) =>
    tokens(parts[index]).some(
      (word) => priority.has(word) || word.includes("'")
    )
  );
  const count = Math.min(
    answerLimits.blanks,
    Math.max(1, Math.round(eligible.length / 5)),
    eligible.length
  );
  return [
    ...preferred,
    ...eligible.filter((index) => !preferred.includes(index)),
  ]
    .slice(0, count)
    .sort((a, b) => a - b);
}
/** 모드별 답안 형태가 달라도 동일한 채점 규칙을 적용한다. */
export function gradeAnswer(
  text: string,
  mode: Mode,
  answer: string | string[]
): Grade {
  if (mode === 'full') return grade(text, answer as string);
  const words = text.trim().split(/\s+/);
  const results = blankIndices(text).map((index, position) =>
    grade(words[index], (answer as string[])[position] ?? '')
  );
  return {
    correct: results.length > 0 && results.every((result) => result.correct),
    differences: results.flatMap((result) => result.differences),
  };
}
