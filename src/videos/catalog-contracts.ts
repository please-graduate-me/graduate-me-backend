import { z } from 'zod';

/** 목록 요청의 크기를 제한하고 정렬 방식을 명시한다. */
export const publicVideoQuerySchema = z.object({
  language: z.enum(['en', 'th']).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['popular', 'latest']).default('popular'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** 서버 조회와 요청 검증이 같은 정렬 규칙을 사용하게 한다. */
export type PublicVideoQuery = z.infer<typeof publicVideoQuerySchema>;
