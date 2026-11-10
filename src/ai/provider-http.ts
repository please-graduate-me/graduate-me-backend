import { HttpError } from '../common/http-error.js';
import type { ProviderInput } from './provider-contracts.js';

/** 응답 본문을 제한해 공급자 오류나 비정상 대용량 출력을 처리하지 않는다. */
export async function readProviderJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();

  if (!reader) throw new HttpError(502, 'AI 응답 본문을 확인할 수 없습니다.');
  const chunks: Uint8Array[] = [];
  let size = 0;

  // 전체 JSON을 메모리에 올리기 전에 크기를 제한해 비정상 공급자 응답을 차단한다.
  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4 * 1024 * 1024) throw new Error('응답 한도 초과');
      chunks.push(chunk.value);
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(502, 'AI 응답 형식 또는 크기를 확인할 수 없습니다.');
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** 모든 공급자에 같은 대화·이미지 입력 한도를 적용한다. */
export function validateProviderInput(input: ProviderInput) {
  if (
    !input.messages.length ||
    input.messages.length > 30 ||
    input.messages.filter((m) => m.role === 'system').length > 1 ||
    !input.messages.some((m) => m.role === 'user') ||
    input.messages.some((m) => !m.content.trim()) ||
    input.messages.reduce((sum, m) => sum + m.content.length, 0) > 200000
  )
    throw new HttpError(400, 'AI 대화 범위와 입력 길이를 확인해 주세요.');
  if (
    input.image &&
    (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.image.base64) ||
      Buffer.byteLength(input.image.base64, 'base64') > 4 * 1024 * 1024)
  )
    throw new HttpError(400, '페이지 이미지는 4MB 이하로 전달해 주세요.');
}
