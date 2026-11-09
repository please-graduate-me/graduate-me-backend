import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessorService } from './processor.service.js';
import type { UsageService, UsageMeasurement } from '../ai/usage.service.js';

function processor(
  recordUsage = vi
    .fn<(measurement: UsageMeasurement) => Promise<void>>()
    .mockResolvedValue(undefined)
) {
  const usage = {
    execute: async (
      _input: unknown,
      run: (record: typeof recordUsage) => Promise<{ value: unknown }>
    ) => (await run(recordUsage)).value,
  };

  return new ProcessorService(usage as unknown as UsageService);
}

const request = { youtubeId: 'JnfBXjWm7hc' } as const;

const metadata = {
  items: [
    {
      snippet: {
        title: '테스트',
        categoryId: '27',
        liveBroadcastContent: 'none',
      },
      contentDetails: { duration: 'PT3S' },
      status: { privacyStatus: 'public', embeddable: true },
    },
  ],
};

const categories = { items: [{ snippet: { title: '교육' } }] };
const segments = [{ start: 1, end: 2, text: 'Hello there.' }];

function result(data: unknown = { segments }, finishReason = 'STOP') {
  return {
    candidates: [
      { finishReason, content: { parts: [{ text: JSON.stringify(data) }] } },
    ],
  };
}

function fixture(video: unknown = metadata, generated: unknown = result()) {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(video))
    .mockResolvedValueOnce(Response.json(categories))
    .mockResolvedValueOnce(Response.json(generated));

  vi.stubGlobal('fetch', fetch);

  return fetch;
}

beforeEach(() => {
  vi.stubEnv('VIDEO_TRANSCRIPTION_PROVIDER', 'gemini');
  vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key');
  vi.stubEnv('YOUTUBE_API_KEY', 'test-youtube-key');
  vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Gemini 영상 분석 경계', () => {
  it('MVP 길이 초과 영상은 유료 전사 전에 차단한다', async () => {
    vi.stubEnv('MATERIAL_POLICY_PROFILE', 'mvp');

    const fetch = fixture({
      items: [
        { ...metadata.items[0], contentDetails: { duration: 'PT10M1S' } },
      ],
    });

    await expect(processor().run(request, vi.fn())).rejects.toMatchObject({
      code: 'UNSUPPORTED_DURATION',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['한국어로만 작성된 문장입니다.', '1234 !?...'])(
    '학습할 선택 언어가 없는 전사를 후속 준비에 넘기지 않는다: %s',
    async (text) => {
      fixture(metadata, result({ segments: [{ start: 1, end: 2, text }] }));

      await expect(processor().run(request, vi.fn())).rejects.toMatchObject({
        code: 'UNSUITABLE_LEARNING_MATERIAL',
      });
    }
  );

  it('전사를 끄면 키가 있어도 메타데이터와 모델을 호출하지 않는다', async () => {
    vi.stubEnv('VIDEO_TRANSCRIPTION_PROVIDER', 'disabled');
    const fetch = fixture();
    const event = vi.fn();

    await expect(processor().run(request, event)).rejects.toMatchObject({
      code: 'PROCESSOR_CONFIG',
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  });

  it('공식 메타데이터 확인 후 URL을 전달하고 검증한 구절을 학습 계약으로 반환한다', async () => {
    const fetch = fixture();
    const event = vi.fn();

    expect(await processor().run(request, event)).toEqual({
      type: 'complete',
      segments: [{ ...segments[0], index: 0, words: [] }],
    });

    expect(event).toHaveBeenCalledExactlyOnceWith({
      type: 'transcribing',
      title: '테스트',
      duration: 3,
      category: '교육',
      youtubeCategoryId: '27',
    });

    const [metadataUrl, metadataInit] = fetch.mock.calls[0];

    expect(String(metadataUrl)).toContain(
      'www.googleapis.com/youtube/v3/videos'
    );

    expect(String(metadataUrl)).not.toContain('test-youtube-key');

    expect(metadataInit.headers).toEqual({
      'x-goog-api-key': 'test-youtube-key',
    });

    const [url, init] = fetch.mock.calls[2];
    const body = JSON.parse(init.body);

    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
    );

    expect(init.headers['x-goog-api-key']).toBe('test-gemini-key');

    expect(body.contents[0].parts[0]).toEqual({
      fileData: { fileUri: 'https://www.youtube.com/watch?v=JnfBXjWm7hc' },
    });

    expect(body.generationConfig.responseMimeType).toBe('application/json');

    expect(body.generationConfig.responseJsonSchema.required).toContain(
      'segments'
    );
  });

  it.each(['GEMINI_API_KEY', 'YOUTUBE_API_KEY'])(
    '설정 %s가 없으면 외부 API를 호출하지 않는다',
    async (key) => {
      const fetch = fixture();

      vi.stubEnv(key, '');

      await expect(processor().run(request, vi.fn())).rejects.toMatchObject({
        code: 'PROCESSOR_CONFIG',
        retryable: false,
      });

      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it.each([
    { items: [] },
    {
      items: [
        {
          ...metadata.items[0],
          status: { privacyStatus: 'unlisted', embeddable: true },
        },
      ],
    },
    {
      items: [
        {
          ...metadata.items[0],
          status: { privacyStatus: 'public', embeddable: false },
        },
      ],
    },
    {
      items: [
        {
          ...metadata.items[0],
          snippet: {
            ...metadata.items[0].snippet,
            liveBroadcastContent: 'live',
          },
        },
      ],
    },
    {
      items: [
        {
          ...metadata.items[0],
          contentDetails: {
            duration: 'PT3S',
            contentRating: { ytRating: 'ytAgeRestricted' },
          },
        },
      ],
    },
  ])('미지원 영상은 유료 분석 전에 거부한다', async (video) => {
    const fetch = fixture(video);

    await expect(processor().run(request, vi.fn())).rejects.toMatchObject({
      code: 'UNSUPPORTED_VIDEO',
      retryable: false,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['PT0S', 'PT30M1S', 'PT1H', 'P1D', 'invalid'])(
    '잘못되거나 제한을 넘은 영상 길이 %s를 거부한다',
    async (duration) => {
      const fetch = fixture({
        items: [{ ...metadata.items[0], contentDetails: { duration } }],
      });

      await expect(processor().run(request, vi.fn())).rejects.toMatchObject({
        code: 'UNSUPPORTED_DURATION',
      });

      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );

  it('DB 상태 저장 실패 후 Gemini 호출을 시작하지 않는다', async () => {
    const fetch = fixture();

    await expect(
      processor().run(request, async () => {
        throw new Error('DB 실패');
      })
    ).rejects.toMatchObject({ code: 'PROCESSOR_FAILED' });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ start: 1, end: 4, text: 'Hello' }],
    [{ start: 2, end: 1, text: 'Hello' }],
    [
      { start: 0, end: 2, text: 'Hello' },
      { start: 1, end: 3, text: 'World' },
    ],
    [
      { start: 2, end: 3, text: 'Hello' },
      { start: 0, end: 1, text: 'World' },
    ],
  ])('길이·순서·겹침이 잘못된 구절을 저장하지 않는다', async (...invalid) => {
    fixture(metadata, result({ segments: invalid }));

    await expect(processor().run(request, vi.fn())).rejects.toMatchObject({
      code: 'INVALID_TRANSCRIPT',
      retryable: true,
    });
  });

  it('영어 발화가 없으면 빈 학습 자료를 완료 처리하지 않는다', async () => {
    fixture(metadata, result({ segments: [] }));

    await expect(processor().run(request, vi.fn())).rejects.toMatchObject({
      code: 'NO_SPEECH',
      retryable: false,
    });
  });

  it.each([
    ['MAX_TOKENS', true],
    ['SAFETY', false],
  ])('불완전한 결과 %s를 완료로 처리하지 않는다', async (reason, retryable) => {
    fixture(metadata, result({ segments }, reason as string));

    await expect(processor().run(request, vi.fn())).rejects.toMatchObject({
      code: 'GEMINI_INCOMPLETE',
      retryable,
    });
  });

  it('전사 검증에 실패해도 추론을 포함한 실측 토큰과 실제 모델을 먼저 기록한다', async () => {
    fixture(metadata, {
      ...result({ segments }, 'MAX_TOKENS'),
      modelVersion: 'gemini-actual-version',
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 8,
        thoughtsTokenCount: 5,
      },
    });

    const recordUsage = vi
      .fn<(measurement: UsageMeasurement) => Promise<void>>()
      .mockResolvedValue(undefined);

    await expect(
      processor(recordUsage).run(request, vi.fn())
    ).rejects.toMatchObject({
      code: 'GEMINI_INCOMPLETE',
    });

    expect(recordUsage).toHaveBeenCalledExactlyOnceWith({
      provider: 'gemini',
      model: 'gemini-actual-version',
      inputTokens: 12,
      outputTokens: 13,
    });
  });

  it('깨진 JSON 응답을 거부한다', async () => {
    fixture(metadata, {
      candidates: [
        { finishReason: 'STOP', content: { parts: [{ text: '{' }] } },
      ],
    });

    await expect(processor().run(request, vi.fn())).rejects.toMatchObject({
      code: 'PROCESSOR_FAILED',
    });
  });

  it.each([
    [401, false],
    [403, false],
    [429, true],
    [503, true],
  ])(
    'Gemini HTTP %s의 재시도를 구분하고 오류 본문을 감춘다',
    async (status, retryable) => {
      const fetch = fixture();

      fetch
        .mockReset()
        .mockResolvedValueOnce(Response.json(metadata))
        .mockResolvedValueOnce(Response.json(categories))
        .mockResolvedValueOnce(new Response('민감한 외부 오류', { status }));

      await expect(processor().run(request, vi.fn())).rejects.toMatchObject({
        code: 'GEMINI_HTTP',
        retryable,
      });
    }
  );

  it('YouTube 오류도 재시도 정책을 적용한다', async () => {
    const fetch = fixture();

    fetch.mockReset().mockResolvedValueOnce(new Response('', { status: 429 }));

    await expect(processor().run(request, vi.fn())).rejects.toMatchObject({
      code: 'YOUTUBE_HTTP',
      retryable: true,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('소유권 상실을 진행 중인 Gemini 요청 취소로 전달한다', async () => {
    const fetch = fixture();
    const controller = new AbortController();
    let started: (() => void) | undefined;

    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });

    fetch
      .mockReset()
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json(categories))
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener(
              'abort',
              () => reject(init.signal.reason),
              { once: true }
            );

            started?.();
          })
      );

    const pending = processor().run(request, vi.fn(), controller.signal);

    const rejected = expect(pending).rejects.toMatchObject({
      code: 'PROCESSOR_FAILED',
    });

    await ready;
    controller.abort();
    await rejected;
  });

  it('취소된 작업은 외부 요청을 시작하지 않는다', async () => {
    const fetch = fixture();
    const controller = new AbortController();

    controller.abort();

    await expect(
      processor().run(request, vi.fn(), controller.signal)
    ).rejects.toMatchObject({ code: 'PROCESSOR_FAILED' });

    expect(fetch).not.toHaveBeenCalled();
  });
});
