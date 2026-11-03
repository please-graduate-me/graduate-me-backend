/** 검색어의 와일드카드를 이스케이프해 사용자가 입력한 문자열 그대로 찾는다. */
export function containsPattern(value: string) {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}
