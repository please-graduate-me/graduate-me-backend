import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderService } from './provider.service.js';

beforeEach(() => vi.stubEnv('AI_PROVIDER', 'naver'));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function mockProvider() {
  vi.stubEnv('CLOVA_STUDIO_API_KEY', 'provider-fixture');

  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      status: { code: '20000' },
      result: {
        message: { content: '{"meaning":"문맥의 뜻"}' },
        finishReason: 'stop',
        usage: { promptTokens: 12, completionTokens: 8 },
      },
    })
  );

  vi.stubGlobal('fetch', fetch);

  return fetch;
}

describe('네이버 AI의 실제 REST 계약', () => {
  it('키가 없으면 외부 요청을 시작하지 않는다', async () => {
    vi.stubEnv('CLOVA_STUDIO_API_KEY', '');
    const fetch = vi.fn();

    vi.stubGlobal('fetch', fetch);

    await expect(
      new ProviderService().generate({
        messages: [{ role: 'user', content: '뜻' }],
      })
    ).rejects.toMatchObject({ status: 503 });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('HCX-007의 구조화 출력과 측정 토큰을 전달한다', async () => {
    const fetch = mockProvider();

    const schema = {
      type: 'object',
      properties: { meaning: { type: 'string' } },
      required: ['meaning'],
    };

    const result = await new ProviderService().generate({
      messages: [{ role: 'user', content: '선택한 원문' }],
      schema,
    });

    expect(result).toMatchObject({
      provider: 'naver',
      model: 'HCX-007',
      inputTokens: 12,
      outputTokens: 8,
    });

    const [url, init] = fetch.mock.calls[0];

    expect(String(url)).toBe(
      'https://clovastudio.stream.ntruss.com/v3/chat-completions/HCX-007'
    );

    expect(JSON.parse(init.body)).toMatchObject({
      responseFormat: { type: 'json', schema },
      thinking: { effort: 'none' },
    });
  });

  it('페이지 이미지는 HCX-005의 단일 dataUri로만 전달한다', async () => {
    const fetch = mockProvider();

    await new ProviderService().generate({
      model: 'image',
      messages: [
        { role: 'system', content: '원문과 관찰을 구분' },
        { role: 'user', content: '이 도식의 관계는?' },
      ],
      image: { base64: 'aW1hZ2U=', mimeType: 'image/png' },
    });

    const [url, init] = fetch.mock.calls[0];

    expect(String(url)).toContain('/HCX-005');

    expect(JSON.parse(init.body).messages[1].content).toEqual([
      { type: 'image_url', dataUri: { data: 'aW1hZ2U=' } },
      { type: 'text', text: '이 도식의 관계는?' },
    ]);
  });

  it('429 응답도 재시도하지 않고 외부 오류 본문을 감춘다', async () => {
    const fetch = mockProvider().mockResolvedValue(
      new Response('공급자 상세·비밀', { status: 429 })
    );

    await expect(
      new ProviderService().generate({
        messages: [{ role: 'user', content: '원문' }],
      })
    ).rejects.toMatchObject({ status: 429 });

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
