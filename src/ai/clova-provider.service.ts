import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { HttpError } from '../common/http-error.js';

import type {
  ProviderInput,
  ProviderMode,
  ProviderResult,
  RecordProviderUsage,
} from './provider-contracts.js';
import { providerIdentity } from './provider-config.js';
import { readProviderJson, validateProviderInput } from './provider-http.js';

const responseSchema = z.object({
  status: z.object({ code: z.string() }),
  result: z.object({
    message: z.object({ content: z.string().min(1).max(500_000) }),
    finishReason: z.string().optional(),
    stopReason: z.string().optional(),
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative(),
        completionTokens: z.number().int().nonnegative(),
      })
      .optional(),
    inputLength: z.number().int().nonnegative().optional(),
    outputLength: z.number().int().nonnegative().optional(),
  }),
});

const measurementSchema = z.object({
  status: z.object({ code: z.literal('20000') }),
  result: z.object({
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative(),
        completionTokens: z.number().int().nonnegative(),
      })
      .optional(),
    inputLength: z.number().int().nonnegative().optional(),
    outputLength: z.number().int().nonnegative().optional(),
  }),
});

@Injectable()
/** 명시적 생성 요청에서만 CLOVA Studio를 호출하고 자동 재시도하지 않는다. */
export class ClovaProviderService {
  identity(mode: ProviderMode = 'text') {
    return providerIdentity('naver', mode);
  }
  get configured() {
    return this.identity().configured;
  }
  async generate(
    input: ProviderInput,
    signal?: AbortSignal,
    recordUsage?: RecordProviderUsage
  ): Promise<ProviderResult> {
    const key = process.env.CLOVA_STUDIO_API_KEY?.trim();

    if (!key) throw new HttpError(503, '네이버 AI 연결 설정이 필요합니다.');
    const image = input.model === 'image' || Boolean(input.image);

    const model =
      (image
        ? process.env.CLOVA_IMAGE_MODEL
        : process.env.CLOVA_TEXT_MODEL
      )?.trim() || (image ? 'HCX-005' : 'HCX-007');

    const base = new URL(
      process.env.CLOVA_STUDIO_BASE_URL ||
        'https://clovastudio.stream.ntruss.com'
    );

    if (
      base.protocol !== 'https:' ||
      ![
        'clovastudio.stream.ntruss.com',
        'clovastudio.stream.gov-ntruss.com',
      ].includes(base.hostname) ||
      base.username ||
      base.password ||
      model !== (image ? 'HCX-005' : 'HCX-007')
    )
      throw new HttpError(503, '네이버 AI 모델과 주소 설정을 확인해 주세요.');
    validateProviderInput(input);

    const messages: { role: string; content: unknown }[] = input.messages.map(
      (m) => ({ ...m })
    );

    if (image && input.schema) {
      let index = messages.length - 1;

      while (index >= 0 && messages[index].role !== 'user') index -= 1;
      if (index < 0) throw new HttpError(400, '이미지 해석 질문이 필요합니다.');

      messages[index].content =
        `${messages[index].content}\n응답은 아래 스키마에 맞는 JSON만 반환하세요.\n${JSON.stringify(input.schema)}`;
    }

    if (input.image) {
      let index = messages.length - 1;

      while (index >= 0 && messages[index].role !== 'user') index -= 1;
      if (index < 0)
        throw new HttpError(400, '페이지 이미지에 대한 질문이 필요합니다.');

      messages[index] = {
        role: 'user',
        content: [
          { type: 'image_url', dataUri: { data: input.image.base64 } },
          { type: 'text', text: messages[index].content },
        ],
      };
    }

    const body = {
      messages,
      topP: 0.8,
      topK: 0,
      temperature: 0.2,
      repetitionPenalty: 1.1,
      ...(image
        ? { maxTokens: 4096 }
        : { maxCompletionTokens: 8192, thinking: { effort: 'none' } }),
      ...(!image && input.schema
        ? { responseFormat: { type: 'json', schema: input.schema } }
        : {}),
    };

    let response: Response;

    try {
      response = await fetch(new URL(`/v3/chat-completions/${model}`, base), {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${key}`,
          'X-NCP-CLOVASTUDIO-REQUEST-ID': randomUUID(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([
          AbortSignal.timeout(120_000),
          ...(signal ? [signal] : []),
        ]),
      });
    } catch {
      throw new HttpError(
        502,
        '네이버 AI 응답을 받지 못했습니다. 자동 재시도하지 않았습니다.'
      );
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(
        response.status === 429 ? 429 : 502,
        '네이버 AI 요청에 실패했습니다. 설정과 사용 한도를 확인해 주세요.'
      );
    }

    const value = await readProviderJson(response);
    const measurement = measurementSchema.safeParse(value);

    if (measurement.success) {
      const result = measurement.data.result;

      await recordUsage?.({
        provider: 'naver',
        model,
        inputTokens: result.usage?.promptTokens ?? result.inputLength ?? null,
        outputTokens:
          result.usage?.completionTokens ?? result.outputLength ?? null,
      });
    }

    const parsed = responseSchema.safeParse(value);

    if (!parsed.success || parsed.data.status.code !== '20000')
      throw new HttpError(502, '네이버 AI 응답 형식을 확인할 수 없습니다.');
    const result = parsed.data.result;

    if (
      (result.finishReason && result.finishReason !== 'stop') ||
      /length/i.test(result.stopReason || '')
    )
      throw new HttpError(
        502,
        '네이버 AI가 완성된 결과를 반환하지 않았습니다.'
      );

    return {
      text: result.message.content,
      provider: 'naver',
      model,
      inputTokens: result.usage?.promptTokens ?? result.inputLength ?? null,
      outputTokens:
        result.usage?.completionTokens ?? result.outputLength ?? null,
    };
  }
}
