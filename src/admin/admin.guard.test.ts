import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';
import type { AdminService } from './admin.service.js';

function context(request: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

describe('백오피스 권한', () => {
  it('일반 계정의 운영 데이터 접근을 거부한다', async () => {
    const allowed = vi.fn().mockResolvedValue(false);
    const guard = new AdminGuard({ allowed } as unknown as AdminService);

    await expect(
      guard.canActivate(context({ userId: 'ordinary' }))
    ).rejects.toMatchObject({ status: 403 });

    expect(allowed).toHaveBeenCalledWith('ordinary');
  });

  it('허용된 관리자만 통과한다', async () => {
    const guard = new AdminGuard({
      allowed: vi.fn().mockResolvedValue(true),
    } as unknown as AdminService);

    await expect(guard.canActivate(context({ userId: 'admin' }))).resolves.toBe(
      true
    );
  });
});
