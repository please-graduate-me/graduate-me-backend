import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { HttpError } from '../common/http-error.js';
import type {
  ProviderInput,
  ProviderMode,
  ProviderResult,
} from './provider-contracts.js';
import { providerIdentity } from './provider-config.js';
import { readProviderJson, validateProviderInput } from './provider-http.js';
import { anthropicSchema } from './anthropic-schema.js';

const tokenCount = z.number().int().nonnegative();

const responseSchema = z.object({
  type: z.literal('message'),
  model: z.string().min(1).max(150),
  role: z.literal('assistant'),
  content: z
    .array(
      z.union([
        z.object({ type: z.literal('text'), text: z.string().max(500000) }),
        z.object({ type: z.enum(['thinking', 'redacted_thinking']) }),
      ])
    )
    .max(100),
  stop_reason: z.string(),
  stop_details: z.object({ type: z.string().optional() }).nullish(),
  usage: z
    .object({
      input_tokens: tokenCount,
      output_tokens: tokenCount,
      cache_creation_input_tokens: tokenCount.optional(),
      cache_read_input_tokens: tokenCount.optional(),
    })
    .optional(),
});

@Injectable()
/** 선택된 Claude 모델을 직접 한 번 호출하며 실패 시 다른 공급자를 실행하지 않는다. */
export class AnthropicProviderService {
  identity(mode: ProviderMode = 'text') {
    return providerIdentity('anthropic', mode);
  }
  get configured() {
    return this.identity().configured;
  }
  async generate(
    input: ProviderInput,
    signal?: AbortSignal
  ): Promise<ProviderResult> {
    const identity = this.identity(
      input.image || input.model === 'image' ? 'image' : 'text'
    );

    if (!identity.configured)
      throw new HttpError(503, 'Claude API 키와 모델 설정을 확인해 주세요.');
    validateProviderInput(input);
    const system = input.messages.find((m) => m.role === 'system')?.content;

    const messages: { role: 'user' | 'assistant'; content: unknown }[] =
      input.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

    if (messages[0]?.role !== 'user' || messages.at(-1)?.role !== 'user')
      throw new HttpError(
        400,
        'Claude 대화는 사용자 질문으로 시작하고 끝나야 합니다.'
      );

    if (input.image) {
      const last = messages.length - 1;

      messages[last].content = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: input.image.mimeType,
            data: input.image.base64,
          },
        },
        { type: 'text', text: messages[last].content },
      ];
    }

    const body = {
      model: identity.model,
      max_tokens: 8192,
      stream: false,
      ...(system ? { system } : {}),
      messages,
      ...(input.schema
        ? {
            output_config: {
              format: {
                type: 'json_schema',
                schema: anthropicSchema(input.schema),
              },
            },
          }
        : {}),
    };

    let response: Response;

    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!.trim(),
          'anthropic-version': '2026-10-21',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([
          AbortSignal.timeout(120000),
          ...(signal ? [signal] : []),
        ]),
      });
    } catch {
      throw new HttpError(
        502,
        'Claude 응답을 받지 못했습니다. 자동 재시도하지 않았습니다.'
      );
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(
        response.status === 429 ? 429 : 502,
        'Claude 요청에 실패했습니다. 설정과 사용 한도를 확인해 주세요.'
      );
    }

    const parsed = responseSchema.safeParse(await readProviderJson(response));

    if (!parsed.success)
      throw new HttpError(502, 'Claude 응답 형식을 확인할 수 없습니다.');
    const result = parsed.data;

    if (
      result.stop_reason !== 'end_turn' ||
      result.stop_details?.type === 'refusal'
    )
      throw new HttpError(
        502,
        'Claude가 완성된 학습 결과를 반환하지 않았습니다. 자동 재시도하지 않았습니다.'
      );

    const text = result.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');

    if (!text.trim())
      throw new HttpError(
        502,
        'Claude가 학습 결과 텍스트를 반환하지 않았습니다.'
      );
    const usage = result.usage;

    return {
      text,
      provider: 'anthropic',
      model: result.model,
      inputTokens: usage
        ? usage.input_tokens +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0)
        : null,
      outputTokens: usage?.output_tokens ?? null,
    };
  }
}
