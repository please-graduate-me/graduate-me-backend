import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authRequestOrigin, normalizeAuthOrigin } from './request-origin.js';

function request(host: string, forwarded?: string, protocol = 'http') {
  return {
    headers: {
      host,
      ...(forwarded ? { 'x-forwarded-host': forwarded } : {}),
      'x-forwarded-proto': protocol,
    },
  } as unknown as Request;
}

afterEach(() => vi.unstubAllEnvs());

describe('인증 공개 출처 선택', () => {
  it('학생·관리자에 정확히 등록한 호스트만 선택하고 프로토콜은 설정에서 결정한다', () => {
    vi.stubEnv('AUTH_URL', 'https://pleasegraduate.me');
    vi.stubEnv('ADMIN_URL', 'https://admin.pleasegraduate.me');

    expect(authRequestOrigin(request('admin.pleasegraduate.me')).origin).toBe(
      'https://admin.pleasegraduate.me'
    );

    expect(
      authRequestOrigin(request('api:4000', 'admin.pleasegraduate.me', 'http'))
        .origin
    ).toBe('https://admin.pleasegraduate.me');

    expect(
      authRequestOrigin(request('pleasegraduate.me', 'evil.example')).origin
    ).toBe('https://pleasegraduate.me');

    for (const forwarded of [
      'admin.pleasegraduate.me.evil.test',
      'admin.pleasegraduate.me,evil.test',
      'https://admin.pleasegraduate.me',
      'admin.pleasegraduate.me@evil.test',
    ])
      expect(authRequestOrigin(request('api:4000', forwarded)).origin).toBe(
        'https://pleasegraduate.me'
      );
  });

  it('같은 출처의 기존 관리자 경로와 Compose 내부 학생 조회도 호환한다', () => {
    vi.stubEnv('AUTH_URL', 'http://localhost:3000');
    vi.stubEnv('ADMIN_URL', 'http://localhost:3000/admin/');

    expect(authRequestOrigin(request('api:4000')).origin).toBe(
      'http://localhost:3000'
    );

    const req = request('api:4000', 'localhost:3000', 'https');
    const next = vi.fn();

    normalizeAuthOrigin(req, {} as never, next);

    expect(req.headers).toMatchObject({
      host: 'localhost:3000',
      'x-forwarded-host': 'localhost:3000',
      'x-forwarded-proto': 'http',
    });

    expect(next).toHaveBeenCalledOnce();
  });
});
