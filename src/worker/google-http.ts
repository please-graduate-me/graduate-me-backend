import { ProcessingError } from './contracts.js';

/** 외부 API 오류 본문과 키를 노출하지 않고 재시도 가능한 장애만 구분한다. */
export async function googleJson(
  url: string | URL,
  init: RequestInit,
  provider: 'GEMINI' | 'YOUTUBE'
): Promise<unknown> {
  const response = await fetch(url, { ...init, redirect: 'error' });

  if (!response.ok) {
    await response.body?.cancel();
    throw new ProcessingError(
      `${provider}_HTTP`,
      `${provider} API 요청에 실패했습니다. 설정과 사용량을 확인해 주세요.`,
      response.status === 429 || response.status >= 500
    );
  }

  return response.json();
}
