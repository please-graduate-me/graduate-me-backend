import { Inject, Injectable } from '@nestjs/common';
import { UsageService } from '../ai/usage.service.js';
import { z } from 'zod';
import { ProcessingError, type ProcessorEvent } from './contracts.js';
import { googleJson } from './google-http.js';
import { youtubeMetadata } from './youtube-metadata.js';
import {
  geminiResponseSchema,
  parseTranscript,
  transcriptionPrompt,
} from './gemini-transcript.js';

const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        finishReason: z.string(),
        content: z
          .object({
            parts: z.array(
              z.object({
                text: z.string().optional(),
                thought: z.boolean().optional(),
              })
            ),
          })
          .optional(),
      })
    )
    .optional(),
});

/** 공식 영상 정보와 Gemini 전사를 작업 큐에 연결한다. */
@Injectable()
export class ProcessorService {
  constructor(@Inject(UsageService) private readonly usage: UsageService) {}
  async run(
    request: {
      youtubeId: string;
      videoId?: string;
      language?: 'en' | 'th';
      ownerId?: string | null;
    },
    onEvent: (event: ProcessorEvent) => Promise<void>,
    signal?: AbortSignal
  ): Promise<ProcessorEvent> {
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const youtubeKey = process.env.YOUTUBE_API_KEY?.trim();
    const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';

    if (!geminiKey || !youtubeKey || !/^[a-zA-Z0-9._-]+$/.test(model)) {
      throw new ProcessingError(
        'PROCESSOR_CONFIG',
        'GEMINI_API_KEY, YOUTUBE_API_KEY와 GEMINI_MODEL 설정을 확인해 주세요.'
      );
    }

    if (!/^[a-zA-Z0-9_-]{11}$/.test(request.youtubeId)) {
      throw new ProcessingError(
        'UNSUPPORTED_VIDEO',
        '올바른 유튜브 영상 ID가 아닙니다.'
      );
    }

    const combined = AbortSignal.any([
      AbortSignal.timeout(900000),
      ...(signal ? [signal] : []),
    ]);

    try {
      combined.throwIfAborted();

      const metadata = await youtubeMetadata(
        request.youtubeId,
        youtubeKey,
        combined
      );

      await onEvent({ type: 'transcribing', ...metadata });
      // DB 상태 저장이나 소유권 확인에 실패하면 유료 분석을 시작하지 않는다.
      combined.throwIfAborted();

      const segments = await this.usage.execute(
        {
          ownerId: request.ownerId ?? null,
          provider: 'gemini',
          task: 'video_transcription',
          model,
          sourceKey: `video:${request.videoId ?? request.youtubeId}:${request.language ?? 'en'}`,
          reservedOutputTokens: 32768,
        },
        async () => {
          const raw = await googleJson(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
              method: 'POST',
              signal: combined,
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': geminiKey,
              },
              body: JSON.stringify({
                contents: [
                  {
                    role: 'user',
                    parts: [
                      {
                        fileData: {
                          fileUri: `https://www.youtube.com/watch?v=${request.youtubeId}`,
                        },
                      },
                      {
                        text: transcriptionPrompt(
                          metadata.duration,
                          request.language ?? 'en'
                        ),
                      },
                    ],
                  },
                ],
                generationConfig: {
                  responseMimeType: 'application/json',
                  responseJsonSchema: geminiResponseSchema,
                  maxOutputTokens: 32768,
                },
              }),
            },
            'GEMINI'
          );

          const candidate = responseSchema.parse(raw).candidates?.[0];

          if (
            !candidate ||
            candidate.finishReason !== 'STOP' ||
            !candidate.content
          ) {
            const retryable = candidate?.finishReason === 'MAX_TOKENS';

            throw new ProcessingError(
              'GEMINI_INCOMPLETE',
              'Gemini가 완전한 전사 결과를 반환하지 않았습니다.',
              retryable
            );
          }

          const text = candidate.content.parts
            .filter((part) => !part.thought)
            .map((part) => part.text ?? '')
            .join('');

          const segments = parseTranscript(text, metadata.duration);

          const usage = z
            .object({
              usageMetadata: z
                .object({
                  promptTokenCount: z.number().int().nonnegative().optional(),
                  candidatesTokenCount: z
                    .number()
                    .int()
                    .nonnegative()
                    .optional(),
                })
                .optional(),
            })
            .parse(raw).usageMetadata;

          return {
            value: segments,
            inputTokens: usage?.promptTokenCount ?? null,
            outputTokens: usage?.candidatesTokenCount ?? null,
          };
        }
      );

      combined.throwIfAborted();

      return { type: 'complete', segments };
    } catch (error) {
      if (error instanceof ProcessingError) throw error;
      throw new ProcessingError(
        'PROCESSOR_FAILED',
        '영상 정보 조회 또는 Gemini 결과 검증에 실패했습니다.',
        true
      );
    }
  }
}
