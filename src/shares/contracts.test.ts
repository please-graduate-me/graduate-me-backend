import { describe, expect, it } from 'vitest';
import { createShareSchema, shareVisitSchema } from './contracts.js';
import { adminShareQuerySchema } from '../admin/contracts.js';

describe('공유 요청 계약', () => {
  it('생성·방문에 재전송 식별자를 요구한다', () => {
    expect(createShareSchema.safeParse({ videoId: 'video' }).success).toBe(
      false
    );

    expect(shareVisitSchema.safeParse({ visitId: 'invalid' }).success).toBe(
      false
    );
  });

  it('관리자 조회 크기를 제한한다', () => {
    expect(adminShareQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(adminShareQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(adminShareQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  });
});
