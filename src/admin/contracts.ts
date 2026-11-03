import { z } from 'zod';

/** 관리자 목록의 조회 범위를 제한한다. */
export const adminShareQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

/** 관리자 목록 요청은 검증 규칙에서 추론한다. */
export type AdminShareQuery = z.infer<typeof adminShareQuerySchema>;
