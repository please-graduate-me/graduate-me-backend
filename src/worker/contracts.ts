import { z } from 'zod';

const interval = z
  .object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().positive(),
  })
  .refine((value) => value.end > value.start);

const segment = z
  .object({
    index: z.number().int().nonnegative(),
    start: z.number().finite().nonnegative(),
    end: z.number().finite().positive(),
    text: z.string().min(1),
    words: z.array(
      z
        .object({
          word: z.string().min(1),
          start: z.number().finite().nonnegative(),
          end: z.number().finite().positive(),
        })
        .refine((word) => word.end > word.start)
    ),
  })
  .refine((value) => value.end > value.start);

/** Python 출력은 DB에 반영하기 전에 버전과 시간 정보를 검증한다. */
export const processorEventSchema = z.discriminatedUnion('type', [
  z.object({ version: z.literal(1), type: z.literal('heartbeat') }),
  z.object({ version: z.literal(1), type: z.literal('downloaded') }),
  z.object({
    version: z.literal(1),
    type: z.literal('transcribing'),
    title: z.string().min(1),
    duration: z.number().finite().positive().max(900),
    category: z.string().nullable(),
    youtubeCategoryId: z.string().nullable(),
  }),
  z.object({
    version: z.literal(1),
    type: z.literal('complete'),
    segments: z
      .array(segment)
      .min(1)
      .refine((items) =>
        items.every(
          (item, index) =>
            item.index === index &&
            (index === 0 || item.start >= items[index - 1].end)
        )
      ),
    speechRegions: z.array(interval).min(1),
    filterVersion: z.number().int().positive(),
  }),
  z.object({
    version: z.literal(1),
    type: z.literal('rechecked'),
    speechRegions: z.array(interval),
    filterVersion: z.number().int().positive(),
  }),
  z.object({
    version: z.literal(1),
    type: z.literal('error'),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
]);

/** 처리기와의 통신 계약은 백엔드가 자체 검증한다. */
export type ProcessorEvent = z.infer<typeof processorEventSchema>;

/** 실제 처리 실패와 실행 환경 실패를 같은 재시도 정책으로 전달한다. */
export class ProcessingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
  }
}

/** DB 작업 소유권은 Python에 전달하지 않고 NestJS 안에서만 유지한다. */
export interface ClaimedJob {
  id: string;
  videoId: string;
  youtubeId: string;
  attempts: number;
  leaseToken: string;
}
