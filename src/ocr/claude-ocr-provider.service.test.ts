import { afterEach, expect, it, vi } from 'vitest';
import { AnthropicProviderService } from '../ai/anthropic-provider.service.js';
import { ClovaOcrProviderService } from './clova-ocr-provider.service.js';
import { ClaudeOcrProviderService } from './claude-ocr-provider.service.js';
import { OcrProviderService } from './ocr-provider.service.js';
import { PdfRasterizerService } from './pdf-rasterizer.service.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('선택한 Claude만 호출하고 픽셀 영역·실제 사용량·미제공 신뢰도를 보존한다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('실제 요청 금지');
    })
  );

  vi.stubEnv('OCR_PROVIDER', '');

  const image = { data: Buffer.from('모의 이미지'), width: 512, height: 1024 };

  const payload = {
    width: 512,
    height: 1024,
    fields: [
      {
        text: 'สวัสดี Hello',
        rect: { x: 51.2, y: 102.4, width: 256, height: 102.4 },
        lineBreak: true,
      },
    ],
  };

  const generate = vi.fn(async () => ({
    text: JSON.stringify(payload),
    provider: 'anthropic' as const,
    model: 'claude-mock-actual',
    inputTokens: 1234,
    outputTokens: 200,
  }));

  const anthropic = {
    identity: () => ({
      provider: 'anthropic' as const,
      model: 'claude-mock',
      configured: true,
    }),
    generate,
  } as unknown as AnthropicProviderService;

  const rasterize = vi.fn(async () => image);

  const claude = new ClaudeOcrProviderService(anthropic, {
    rasterize,
  } as unknown as PdfRasterizerService);

  const clova = {
    identity: () => ({
      provider: 'naver' as const,
      model: 'CLOVA OCR General V2',
      configured: true,
      supportedLanguages: ['en'] as const,
    }),
    recognize: vi.fn(),
  };

  const provider = new OcrProviderService(
    clova as unknown as ClovaOcrProviderService,
    claude
  );

  expect(provider.identity()).toMatchObject({
    provider: 'naver',
    supportedLanguages: ['en'],
  });

  vi.stubEnv('OCR_PROVIDER', 'anthropic');
  const identity = provider.identity();

  expect(identity).toMatchObject({
    provider: 'anthropic',
    supportedLanguages: ['en', 'th'],
  });

  expect(provider.reservation(identity)).toMatchObject({
    estimatedInputTokens: expect.any(Number),
    reservedOutputTokens: 8192,
  });

  expect(provider.reservation(identity).estimatedInputTokens).toBeGreaterThan(
    12000
  );

  const input = {
    data: Buffer.from('%PDF-'),
    width: 400,
    height: 800,
    requestId: 'mock',
  };

  const recordUsage = vi.fn().mockResolvedValue(undefined);
  const recognized = await provider.recognize(input, identity, recordUsage);

  expect(rasterize).toHaveBeenCalledWith(input);

  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'image',
      image: { mimeType: 'image/png', base64: image.data.toString('base64') },
    }),
    undefined,
    recordUsage
  );

  expect(recognized).toMatchObject({
    provider: 'anthropic',
    model: 'claude-mock-actual',
    inputTokens: 1234,
    outputTokens: 200,
    result: {
      text: 'สวัสดี Hello',
      lowConfidenceCount: 0,
      fields: [
        { confidence: null, rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 } },
      ],
    },
  });

  expect(clova.recognize).not.toHaveBeenCalled();

  payload.fields[0].rect.width = 600;
  recordUsage.mockClear();

  await expect(
    provider.recognize(input, identity, recordUsage)
  ).rejects.toMatchObject({ status: 502 });

  expect(recordUsage).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: 'anthropic',
      model: 'claude-mock-actual',
      inputTokens: 1234,
      outputTokens: 200,
    })
  );

  vi.stubEnv('OCR_PROVIDER', 'clova');

  await expect(provider.recognize(input, identity)).rejects.toMatchObject({
    status: 409,
  });

  vi.stubEnv('OCR_PROVIDER', 'unknown');
  expect(() => provider.identity()).toThrow();
  expect(clova.recognize).not.toHaveBeenCalled();
});
