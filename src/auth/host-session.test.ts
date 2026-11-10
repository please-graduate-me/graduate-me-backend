import 'reflect-metadata';
import { request as httpRequest, type Server } from 'node:http';
import express from 'express';
import { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AuthService } from './auth.service.js';
import { normalizeAuthOrigin } from './request-origin.js';

type Reply = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};
let server: Server, port: number, auth: AuthService;

function localRequest(
  host: string,
  path: string,
  method = 'GET',
  body?: string,
  cookie?: string
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          host,
          ...(body
            ? {
                'content-type': 'application/x-www-form-urlencoded',
                'content-length': Buffer.byteLength(body),
              }
            : {}),
          ...(cookie ? { cookie } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 500,
            headers: response.headers,
            body: Buffer.concat(chunks).toString(),
          })
        );
      }
    );

    request.on('error', reject);
    request.end(body);
  });
}

function cookies(reply: Reply) {
  return (reply.headers['set-cookie'] as string[]) ?? [];
}

function jar(reply: Reply) {
  return cookies(reply)
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

describe('허용된 앱별 OAuth·host-only 세션 계약', () => {
  beforeAll(async () => {
    const app = express();

    app.set('trust proxy', true);
    app.use(normalizeAuthOrigin);
    app.use(express.urlencoded({ extended: false }));

    app.get('/session-check', async (req, res) =>
      res.json(await auth.session(req))
    );

    app.use(/^\/api\/auth\/(.*)$/, (req, res, next) =>
      auth.handle(req, res, next)
    );

    server = await new Promise((resolve) => {
      const running = app.listen(0, '127.0.0.1', () => resolve(running));
    });

    const address = server.address();

    if (!address || typeof address === 'string')
      throw new Error('로컬 계약 서버 포트를 확인할 수 없습니다.');
    port = address.port;
  });

  beforeEach(() => {
    vi.stubEnv('AUTH_URL', 'https://pleasegraduate.me');
    vi.stubEnv('ADMIN_URL', 'https://admin.pleasegraduate.me');
    vi.stubEnv('AUTH_SECRET', 'local-contract-secret-not-a-real-key-32chars');
    vi.stubEnv('AUTH_GOOGLE_ID', 'mock-client-id');
    vi.stubEnv('AUTH_GOOGLE_SECRET', 'mock-client-secret');
    const db = { getRepository: () => ({}) } as unknown as DataSource;

    auth = new AuthService(db);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);

        if (
          url !== 'https://accounts.google.com/.well-known/openid-configuration'
        )
          throw new Error('실제 외부 요청 금지');

        return Response.json({
          issuer: 'https://accounts.google.com',
          authorization_endpoint:
            'https://accounts.google.com/o/oauth2/v2/auth',
          token_endpoint: 'https://oauth2.googleapis.com/token',
          jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
          userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it('실제 ExpressAuth의 CSRF·state·PKCE 쿠키와 Google redirect_uri가 시작한 호스트에 남는다', async () => {
    for (const host of ['pleasegraduate.me', 'admin.pleasegraduate.me']) {
      const csrf = await localRequest(host, '/api/auth/csrf');

      expect(csrf.status).toBe(200);
      const csrfToken = JSON.parse(csrf.body).csrfToken as string;

      const signin = await localRequest(
        host,
        '/api/auth/signin/google',
        'POST',
        new URLSearchParams({
          csrfToken,
          callbackUrl: `https://${host}/`,
        }).toString(),
        jar(csrf)
      );

      expect(signin.status).toBe(302);
      const target = new URL(String(signin.headers.location));

      expect(target.origin).toBe('https://accounts.google.com');

      expect(target.searchParams.get('redirect_uri')).toBe(
        `https://${host}/api/auth/callback/google`
      );

      expect(target.searchParams.get('state')).toBeTruthy();
      expect(target.searchParams.get('code_challenge_method')).toBe('S256');

      expect(
        cookies(signin).some((cookie) =>
          cookie.startsWith('__Secure-authjs.pkce.code_verifier=')
        )
      ).toBe(true);

      expect(
        cookies(signin).some((cookie) =>
          cookie.startsWith('__Secure-authjs.state=')
        )
      ).toBe(true);

      for (const cookie of [...cookies(csrf), ...cookies(signin)]) {
        expect(cookie).toMatch(/; Secure/i);
        expect(cookie).toMatch(/; HttpOnly/i);
        expect(cookie).not.toMatch(/;\s*Domain=/i);
      }
    }
    expect(auth.config.useSecureCookies).toBeUndefined();
    expect(auth.config.providers[0]).not.toHaveProperty('clientId');
  });

  it('다른 호스트에서 발급한 CSRF와 현재 호스트 쿠키를 섞으면 OAuth로 진행하지 않는다', async () => {
    const student = await localRequest('pleasegraduate.me', '/api/auth/csrf');

    const admin = await localRequest(
      'admin.pleasegraduate.me',
      '/api/auth/csrf'
    );

    const response = await localRequest(
      'admin.pleasegraduate.me',
      '/api/auth/signin/google',
      'POST',
      new URLSearchParams({
        csrfToken: JSON.parse(student.body).csrfToken,
        callbackUrl: 'https://admin.pleasegraduate.me/',
      }).toString(),
      jar(admin)
    );

    expect(response.status).toBe(302);

    expect(new URL(String(response.headers.location)).origin).toBe(
      'https://admin.pleasegraduate.me'
    );

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('AUTH_URL이 HTTP 학생 주소여도 HTTPS 관리자 세션의 보안 쿠키와 DB 계약을 사용한다', async () => {
    vi.stubEnv('AUTH_URL', 'http://localhost:3000');

    const getSessionAndUser = vi.fn(async (sessionToken: string) => ({
      session: {
        sessionToken,
        userId: sessionToken,
        expires: new Date(Date.now() + 3600000),
      },
      user: {
        id: sessionToken,
        name: '세션 검증 계정',
        email: 'session@example.test',
        emailVerified: null,
        image: null,
      },
    }));

    auth.config.adapter = {
      ...auth.config.adapter,
      getSessionAndUser,
      updateSession: vi.fn(async (input) => input as never),
    };

    const admin = await localRequest(
      'admin.pleasegraduate.me',
      '/session-check',
      'GET',
      undefined,
      '__Secure-authjs.session-token=admin-session'
    );

    const student = await localRequest(
      'localhost:3000',
      '/session-check',
      'GET',
      undefined,
      'authjs.session-token=student-session'
    );

    expect(JSON.parse(admin.body).user.id).toBe('admin-session');
    expect(JSON.parse(student.body).user.id).toBe('student-session');

    expect(getSessionAndUser.mock.calls.map((args) => args[0])).toEqual([
      'admin-session',
      'student-session',
    ]);

    expect(auth.config.useSecureCookies).toBeUndefined();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
