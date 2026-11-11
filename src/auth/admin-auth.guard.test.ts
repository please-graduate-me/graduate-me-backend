import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { AdminAuthGuard } from './admin-auth.guard.js';
import type { AdminAuthService } from './admin-auth.service.js';

function context(request: unknown) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: vi.fn() }),
    }),
  } as ExecutionContext;
}

describe('운영자 전용 인증 경계', () => {
  it('Google 사용자 식별자가 있어도 운영 세션이 없으면 거부한다', async () => {
    const guard = new AdminAuthGuard({
      session: vi.fn().mockResolvedValue(null),
    } as unknown as AdminAuthService);

    await expect(
      guard.canActivate(context({ method: 'GET', userId: 'google-helper' }))
    ).rejects.toMatchObject({ status: 401 });
  });

  it('변경 요청은 운영 콘솔 출처를 확인한 뒤 운영 식별자로 덮어쓴다', async () => {
    const assertOrigin = vi.fn();

    const guard = new AdminAuthGuard({
      session: vi.fn().mockResolvedValue('operator'),
      assertOrigin,
    } as unknown as AdminAuthService);

    const request = { method: 'POST', userId: 'google-user' };

    expect(await guard.canActivate(context(request))).toBe(true);
    expect(request.userId).toBe('operator');
    expect(assertOrigin).toHaveBeenCalledWith(request);
  });
});
