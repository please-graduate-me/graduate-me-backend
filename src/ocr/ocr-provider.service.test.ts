import { randomUUID } from 'node:crypto';
import { PDFDocument, degrees } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OcrProviderService, parseOcrResult } from './ocr-provider.service.js';
import { extractOcrPage } from './pdf-page.js';
import { HttpError } from '../common/http-error.js';

function response(requestId: string) {
  return {
    version: 'V2',
    requestId,
    images: [
      {
        inferResult: 'SUCCESS',
        convertedImageInfo: { width: 100, height: 200, pageIndex: 0 },
        fields: [
          {
            inferText: 'Hello',
            inferConfidence: 0.7,
            lineBreak: true,
            boundingPoly: {
              vertices: [
                { x: 10, y: 20 },
                { x: 90, y: 20 },
                { x: 90, y: 40 },
                { x: 10, y: 40 },
              ],
            },
          },
        ],
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('저장 PDF 한 페이지와 CLOVA OCR General V2', () => {
  it('잘린 영역과 회전을 고정해 한 페이지만 전송하고 좌표·신뢰도를 정규화한다', async () => {
    const pdf = await PDFDocument.create();

    pdf.addPage([600, 800]);
    const selected = pdf.addPage([400, 300]);

    selected.setCropBox(10, 20, 200, 100);
    selected.setRotation(degrees(90));
    selected.drawText('Selected source');
    const page = await extractOcrPage(Buffer.from(await pdf.save()), 2);
    const normalized = await PDFDocument.load(page.data);

    expect(normalized.getPageCount()).toBe(1);

    expect(normalized.getPage(0).getSize()).toEqual({
      width: 100,
      height: 200,
    });

    expect(normalized.getPage(0).getRotation().angle).toBe(0);

    vi.stubEnv(
      'CLOVA_OCR_INVOKE_URL',
      'https://example.apigw.ntruss.com/custom/v1/domain/token/general'
    );

    vi.stubEnv('CLOVA_OCR_SECRET_KEY', 'mock_secret');
    const requestId = randomUUID();

    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify(response(requestId)))
    );

    vi.stubGlobal('fetch', fetch);

    const result = await new OcrProviderService().recognize({
      ...page,
      requestId,
    });

    const init = fetch.mock.calls[0]?.[1] as RequestInit | undefined;

    expect(init).toMatchObject({
      redirect: 'error',
      headers: { 'X-OCR-SECRET': 'mock_secret' },
    });

    const body = JSON.parse(String(init?.body));

    expect(body).not.toHaveProperty('lang');
    expect(body.images).toHaveLength(1);
    expect(body.images[0]).toMatchObject({ format: 'pdf', name: 'page' });
    expect(Buffer.from(body.images[0].data, 'base64')).toEqual(page.data);

    expect(result).toMatchObject({
      text: 'Hello',
      lowConfidenceCount: 1,
      width: 100,
      height: 200,
      fields: [
        { confidence: 0.7, rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 } },
      ],
    });
  });

  it('다른 페이지·범위 밖 좌표·다른 비율·다른 요청의 결과를 저장하지 않는다', () => {
    const id = randomUUID();
    const outside = response(id);

    outside.images[0].fields[0].boundingPoly.vertices[0].x = -1;
    expect(() => parseOcrResult(outside, id, 0.5)).toThrow(HttpError);
    expect(() => parseOcrResult(response(id), id, 2)).toThrow(HttpError);

    expect(() => parseOcrResult(response(id), randomUUID(), 0.5)).toThrow(
      HttpError
    );

    const wrongPage = response(id);

    wrongPage.images[0].convertedImageInfo.pageIndex = 1;
    expect(() => parseOcrResult(wrongPage, id, 0.5)).toThrow(HttpError);
  });

  it('비공식 주소를 호출하지 않으며 공급자 오류도 자동 재시도하지 않는다', async () => {
    vi.stubEnv('CLOVA_OCR_INVOKE_URL', 'https://attacker.example/general');
    vi.stubEnv('CLOVA_OCR_SECRET_KEY', 'mock_secret');

    const fetch = vi.fn(
      async () => new Response('secret_response', { status: 429 })
    );

    vi.stubGlobal('fetch', fetch);

    const input = {
      data: Buffer.from('%PDF-'),
      width: 100,
      height: 200,
      requestId: randomUUID(),
    };

    await expect(
      new OcrProviderService().recognize(input)
    ).rejects.toMatchObject({ status: 503 });

    expect(fetch).not.toHaveBeenCalled();

    vi.stubEnv(
      'CLOVA_OCR_INVOKE_URL',
      'https://example.apigw.ntruss.com/custom/v1/domain/token/general'
    );

    await expect(
      new OcrProviderService().recognize(input)
    ).rejects.toMatchObject({ status: 429 });

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
