import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderService } from './provider.service.js';
import { AnthropicProviderService } from './anthropic-provider.service.js';
import { anthropicSchema } from './anthropic-schema.js';

beforeEach(() => {
  vi.stubEnv('AI_PROVIDER', 'anthropic');
  vi.stubEnv('ANTHROPIC_API_KEY', 'mock_claude_key');
  vi.stubEnv('ANTHROPIC_MODEL', 'claude-sonnet-5-5');
  vi.stubEnv('CLOVA_STUDIO_API_KEY', 'mock_clova_key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function message(stop = 'end_turn') {
  return {
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    stop_reason: stop,
    content: [
      { type: 'thinking', thinking: '내부 사고' },
      { type: 'text', text: '{"meaning":"문맥"}' },
    ],
    usage: {
      input_tokens: 12,
      output_tokens: 8,
      cache_creation_input_tokens: 3,
      cache_read_input_tokens: 4,
    },
  };
}

const input = {
  messages: [
    { role: 'system' as const, content: '원문에서 답하세요' },
    { role: 'user' as const, content: '이 구절의 뜻' },
  ],
  schema: {
    type: 'object',
    properties: {
      meaning: { type: 'string', maxLength: 100 },
      choices: {
        type: 'array',
        minItems: 3,
        maxItems: 5,
        items: { type: 'string' },
      },
    },
    required: ['meaning', 'choices'],
  },
};

describe('Claude 공급자의 직접 Messages 계약과 명시적 선택', () => {
  it('system·정형 출력을 변환하고 실제 모델·캐시를 포함한 측정 토큰만 반환한다', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(message()));

    vi.stubGlobal('fetch', fetch);
    const provider = new ProviderService();

    expect(provider.identity('image')).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      configured: true,
    });

    expect(await provider.generate(input)).toEqual({
      text: '{"meaning":"문맥"}',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      inputTokens: 19,
      outputTokens: 8,
    });

    const [url, init] = fetch.mock.calls[0];

    expect(url).toBe('https://api.anthropic.com/v1/messages');

    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        'x-api-key': 'mock_claude_key',
        'anthropic-version': '2026-10-21',
      },
    });

    const body = JSON.parse(String(init?.body));

    expect(body).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: '원문에서 답하세요',
      max_tokens: 8192,
      stream: false,
      output_config: {
        format: {
          type: 'json_schema',
          schema: { additionalProperties: false },
        },
      },
    });

    expect(body.messages).toEqual([{ role: 'user', content: '이 구절의 뜻' }]);

    expect(
      body.output_config.format.schema.properties.meaning
    ).not.toHaveProperty('maxLength');

    expect(
      body.output_config.format.schema.properties.choices
    ).not.toHaveProperty('minItems');

    expect(
      body.output_config.format.schema.properties.choices.description
    ).toContain('minItems');

    expect(input.schema.properties.meaning.maxLength).toBe(100);
  });

  it('이미지는 마지막 사용자 메시지의 base64 블록으로 전달한다', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(message()));

    vi.stubGlobal('fetch', fetch);

    await new AnthropicProviderService().generate({
      ...input,
      image: { base64: 'aW1hZ2U=', mimeType: 'image/png' },
    });

    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));

    expect(body.messages[0].content).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' },
      },
      { type: 'text', text: '이 구절의 뜻' },
    ]);
  });

  it('키 누락·잘못된 선택·429는 CLOVA 대체나 자동 재시도를 하지 않는다', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('민감한 공급자 오류', { status: 429 }));

    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(new ProviderService().configured).toBe(false);

    await expect(new ProviderService().generate(input)).rejects.toMatchObject({
      status: 503,
    });

    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv('AI_PROVIDER', 'unknown');
    expect(() => new ProviderService().identity()).toThrow();
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('ANTHROPIC_API_KEY', 'mock_claude_key');

    await expect(new ProviderService().generate(input)).rejects.toMatchObject({
      status: 429,
      response: { error: expect.not.stringContaining('민감한') },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('중단·거절·과도한 응답을 결과로 쓰지 않고 누락 토큰을 0으로 만들지 않는다', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    vi.stubGlobal('fetch', fetch);
    const provider = new AnthropicProviderService();

    fetch.mockResolvedValueOnce(Response.json(message('max_tokens')));

    const recordUsage = vi.fn().mockResolvedValue(undefined);

    await expect(
      provider.generate(input, undefined, recordUsage)
    ).rejects.toMatchObject({ status: 502 });

    expect(recordUsage).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      inputTokens: 19,
      outputTokens: 8,
    });

    fetch.mockResolvedValueOnce(
      Response.json({ ...message(), stop_details: { type: 'refusal' } })
    );

    await expect(provider.generate(input)).rejects.toMatchObject({
      status: 502,
    });

    fetch.mockResolvedValueOnce(new Response(' '.repeat(4 * 1024 * 1024 + 1)));

    await expect(provider.generate(input)).rejects.toMatchObject({
      status: 502,
    });

    fetch.mockResolvedValueOnce(
      Response.json({ ...message(), usage: undefined })
    );

    expect(await provider.generate(input)).toMatchObject({
      inputTokens: null,
      outputTokens: null,
    });

    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('객체 필드 이름은 제약 키와 같아도 유지하고 중첩 객체를 닫는다', () => {
    const source = {
      type: 'object',
      properties: {
        minimum: { type: 'number', minimum: 0 },
        nested: {
          type: 'object',
          properties: { text: { type: 'string', minLength: 1 } },
        },
      },
    };

    expect(anthropicSchema(source)).toMatchObject({
      additionalProperties: false,
      properties: {
        minimum: {
          type: 'number',
          description: expect.stringContaining('minimum'),
        },
        nested: { additionalProperties: false },
      },
    });
  });
});
