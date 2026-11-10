import { Inject, Injectable, Logger } from '@nestjs/common';
import { ExpressAuth, type ExpressAuthConfig } from '@auth/express';
import { Auth } from '@auth/core';
import Google from '@auth/express/providers/google';
import { typeormAdapter } from './typeorm-adapter.js';
import type { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';
import { authRedirect } from './origins.js';
import { authRequestOrigin } from './request-origin.js';

/** 세션과 OAuth 설정이 여러 API에서 다르게 적용되지 않게 한다. */
@Injectable()
export class AuthService {
  readonly config: ExpressAuthConfig;
  private readonly logger = new Logger(AuthService.name);
  constructor(@Inject(DataSource) private readonly db: DataSource) {
    this.config = {
      basePath: '/api/auth',
      trustHost: true,
      secret: process.env.AUTH_SECRET,
      adapter: typeormAdapter(this.db),
      providers: [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
          checks: ['pkce', 'state'],
        }),
      ],
      session: { strategy: 'database' },
      pages: { signIn: '/', error: '/' },
      logger: {
        // 공개 주소와 인증 경로를 함께 지정하므로 이 중복 안내는 예상된 설정이다.
        warn: (code) => {
          if (code !== 'env-url-basepath-redundant') this.logger.warn(code);
        },
        // 인증 오류의 본문에는 토큰이 섞일 수 있어 오류 종류만 남긴다.
        error: (error) => this.logger.error(error.name),
      },
      callbacks: {
        redirect({ url, baseUrl }) {
          return authRedirect(url, baseUrl);
        },
        session({ session, user }) {
          return { ...session, user: { ...session.user, id: user.id } };
        },
      },
    };
  }
  get configured() {
    return Boolean(
      process.env.AUTH_GOOGLE_ID &&
      process.env.AUTH_GOOGLE_SECRET &&
      process.env.AUTH_SECRET
    );
  }
  forRequest(request: Request): ExpressAuthConfig {
    const origin = authRequestOrigin(request);

    // ExpressAuth가 요청별 기본값을 변경하므로 공유 설정을 복제하고 쿠키는 각 호스트에만 둔다.
    return {
      ...this.config,
      providers: this.config.providers.map((provider) =>
        typeof provider === 'function' ? provider : { ...provider }
      ),
      useSecureCookies: origin.protocol === 'https:',
    };
  }
  handle(request: Request, response: Response, next: NextFunction) {
    return ExpressAuth(this.forRequest(request))(request, response, next);
  }
  async session(request: Request) {
    if (!this.configured) return null;
    const origin = authRequestOrigin(request);

    // express getSession은 전역 AUTH_URL을 우선하므로 직접 현재 앱의 세션 URL을 구성한다.
    const response = await Auth(
      new Request(new URL('/api/auth/session', origin), {
        headers: { cookie: request.headers.cookie ?? '' },
      }),
      this.forRequest(request)
    );

    const value: unknown = await response.json();

    if (!value || typeof value !== 'object' || !Object.keys(value).length)
      return null;
    if (response.status !== 200)
      throw new Error('인증 세션을 확인할 수 없습니다.');

    return value as {
      user?: { id: string; name?: string | null; email?: string | null };
      expires: string;
    };
  }
}
