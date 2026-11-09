import { afterEach, describe, expect, it, vi } from 'vitest';
import { appOrigins, authRedirect } from './origins.js';

afterEach(() => vi.unstubAllEnvs());

describe('학생과 admin 출처 경계', () => {
  it('명시한 admin 주소의 경로만 허용하고 임의 외부 로그인 이동을 거부한다', () => {
    vi.stubEnv('AUTH_URL', 'https://student.example.test');
    vi.stubEnv('ADMIN_URL', 'https://admin.example.test');

    expect(appOrigins()).toEqual([
      'https://student.example.test',
      'https://admin.example.test',
    ]);

    expect(
      authRedirect(
        'https://admin.example.test/questions',
        'https://student.example.test'
      )
    ).toBe('https://admin.example.test/questions');

    expect(
      authRedirect(
        'https://admin.example.test.evil.test',
        'https://student.example.test'
      )
    ).toBe('https://student.example.test');

    expect(
      authRedirect('//evil.example.test', 'https://student.example.test')
    ).toBe('https://student.example.test');
  });
});
