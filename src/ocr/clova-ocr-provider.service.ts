import type { RecordProviderUsage } from '../ai/provider-contracts.js';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { HttpError } from '../common/http-error.js';
import type { OcrResult } from './contracts.js';

const responseSchema = z.object({
  version: z.literal('V2'),
  requestId: z.string(),
  images: z
    .array(
      z.object({
        inferResult: z.literal('SUCCESS'),
        convertedImageInfo: z.object({
          width: z.number().int().positive().max(100000),
          height: z.number().int().positive().max(100000),
          pageIndex: z.literal(0),
        }),
        fields: z
          .array(
            z.object({
              inferText: z.string().max(10000),
              inferConfidence: z.number().min(0).max(1),
              lineBreak: z.boolean(),
              boundingPoly: z.object({
                vertices: z
                  .array(
                    z.object({ x: z.number().finite(), y: z.number().finite() })
                  )
                  .length(4),
              }),
            })
          )
          .max(10000),
      })
    )
    .length(1),
});

/** 응답 좌표가 원본 페이지와 다른 경우 겹침 글자층을 만들지 않는다. */
export function parseOcrResult(
  value: unknown,
  requestId: string,
  aspectRatio: number
): OcrResult {
  const parsed = responseSchema.safeParse(value);

  if (!parsed.success || parsed.data.requestId !== requestId)
    throw new HttpError(502, 'OCR 응답 형식을 확인할 수 없습니다.');
  const image = parsed.data.images[0];
  const { width, height } = image.convertedImageInfo;

  if (Math.abs(width / height / aspectRatio - 1) > 0.03)
    throw new HttpError(
      502,
      'OCR 인식 영역과 PDF 페이지 비율이 일치하지 않습니다.'
    );

  // 범위를 벗어난 좌표를 보정해 숨기면 원문과 다른 위치가 선택 근거가 되므로 거부한다.
  const fields = image.fields.map((field) => {
    const vertices = field.boundingPoly.vertices;

    if (vertices.some((v) => v.x < 0 || v.y < 0 || v.x > width || v.y > height))
      throw new HttpError(502, 'OCR 인식 영역이 페이지 범위를 벗어났습니다.');

    const x = Math.min(...vertices.map((v) => v.x)),
      y = Math.min(...vertices.map((v) => v.y));

    const right = Math.max(...vertices.map((v) => v.x)),
      bottom = Math.max(...vertices.map((v) => v.y));

    if (right <= x || bottom <= y)
      throw new HttpError(502, 'OCR 인식 영역의 크기를 확인할 수 없습니다.');

    return {
      text: field.inferText,
      confidence: field.inferConfidence,
      lineBreak: field.lineBreak,
      rect: {
        x: x / width,
        y: y / height,
        width: (right - x) / width,
        height: (bottom - y) / height,
      },
    };
  });

  const text = fields
    .map((f) => f.text + (f.lineBreak ? '\n' : ' '))
    .join('')
    .trim();

  if (text.length > 50000)
    throw new HttpError(
      502,
      '인식된 페이지 텍스트가 처리 한도를 초과했습니다.'
    );

  return {
    text,
    fields,
    width,
    height,
    lowConfidenceCount: fields.filter(
      (f) => f.confidence !== null && f.confidence < 0.8
    ).length,
  };
}

async function boundedJson(response: Response) {
  const reader = response.body?.getReader();

  if (!reader) throw new Error('빈 응답');
  let size = 0;
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4 * 1024 * 1024) throw new Error('응답 한도 초과');
      chunks.push(chunk.value);
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** 명시적 페이지 인식 요청에서만 CLOVA OCR General V2를 한 번 호출한다. */
@Injectable()
export class ClovaOcrProviderService {
  get configured() {
    return Boolean(
      process.env.CLOVA_OCR_INVOKE_URL?.trim() &&
      process.env.CLOVA_OCR_SECRET_KEY?.trim()
    );
  }
  identity() {
    return {
      provider: 'naver' as const,
      model: 'CLOVA OCR General V2',
      configured: this.configured,
      supportedLanguages: ['en'] as const,
    };
  }
  async recognize(
    input: {
      data: Buffer;
      width: number;
      height: number;
      requestId: string;
    },
    recordUsage?: RecordProviderUsage
  ): Promise<OcrResult> {
    if (!this.configured)
      throw new HttpError(503, 'CLOVA OCR 연결 설정이 필요합니다.');
    let url: URL;

    try {
      url = new URL(process.env.CLOVA_OCR_INVOKE_URL!.trim());
    } catch {
      throw new HttpError(503, 'CLOVA OCR 호출 주소 설정을 확인해 주세요.');
    }

    // 설정 오류로 OCR 비밀 헤더가 외부 주소에 전송되지 않게 공식 호스트와 경로를 제한한다.
    if (
      url.protocol !== 'https:' ||
      !/^[a-zA-Z0-9-]+\.apigw\.(?:ntruss|gov-ntruss)\.com$/.test(
        url.hostname
      ) ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith('/general')
    )
      throw new HttpError(
        503,
        '공식 CLOVA OCR General 호출 주소를 설정해 주세요.'
      );
    if (input.data.length > 10 * 1024 * 1024)
      throw new HttpError(
        413,
        '인식할 PDF 페이지는 10MB 이하로 전달해 주세요.'
      );

    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
        headers: {
          'Content-Type': 'application/json',
          'X-OCR-SECRET': process.env.CLOVA_OCR_SECRET_KEY!.trim(),
        },
        body: JSON.stringify({
          version: 'V2',
          requestId: input.requestId,
          timestamp: Date.now(),
          images: [
            {
              format: 'pdf',
              name: 'page',
              data: input.data.toString('base64'),
            },
          ],
        }),
      });

      if (!response.ok) {
        await response.body?.cancel();
        throw new HttpError(
          response.status === 429 ? 429 : 502,
          'OCR 요청에 실패했습니다. 자동 재시도하지 않았습니다.'
        );
      }

      const value = await boundedJson(response);

      await recordUsage?.({
        provider: 'naver',
        model: this.identity().model,
        inputTokens: null,
        outputTokens: null,
      });

      return parseOcrResult(value, input.requestId, input.width / input.height);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        502,
        'OCR 응답을 처리하지 못했습니다. 자동 재시도하지 않았습니다.'
      );
    }
  }
}
