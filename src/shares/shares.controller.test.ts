import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { SharesController } from './shares.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthService } from '../auth/auth.service.js';

function context(method: string, origin?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, headers: { origin } }),
    }),
  } as ExecutionContext;
}
describe('공유 접근 인증', () => {
  it('조회와 방문 집계를 포함한 모든 공유 경로에 인증을 적용한다', () => {
    expect(Reflect.getMetadata('__guards__', SharesController)).toContain(
      AuthGuard
    );
  });
  it('비로그인 사용자의 조회와 방문 집계를 거부한다', async () => {
    const guard = new AuthGuard({
      session: vi.fn().mockResolvedValue(null),
    } as unknown as AuthService);
    for (const method of ['GET', 'POST'])
      await expect(guard.canActivate(context(method))).rejects.toMatchObject({
        status: 401,
      });
  });
  it('로그인했어도 외부 출처의 집계 요청은 거부한다', async () => {
    const guard = new AuthGuard({
      session: vi.fn().mockResolvedValue({ user: { id: 'learner' } }),
    } as unknown as AuthService);
    await expect(
      guard.canActivate(context('POST', 'https://external.invalid'))
    ).rejects.toMatchObject({ status: 403 });
  });
});
