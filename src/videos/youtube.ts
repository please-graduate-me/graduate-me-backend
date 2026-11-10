/** 허용한 영상 주소만 동일한 식별자로 정규화한다. */
export function parseYouTubeUrl(input: string): string {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new Error('올바른 유튜브 URL을 입력해 주세요.');
  }

  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error('지원하지 않는 URL 형식입니다.');
  }

  if (url.searchParams.has('list'))
    throw new Error('재생목록 대신 개별 영상 URL을 입력해 주세요.');
  // 호스트 부분 일치나 자격증명 URL로 다른 사이트가 YouTube로 오인되지 않게 한다.
  const host = url.hostname.toLowerCase();
  let id: string | null = null;

  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else
      id = url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)\/?$/)?.[1] ?? null;
  }

  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id))
    throw new Error('지원하는 유튜브 영상 URL이 아닙니다.');

  return id;
}
