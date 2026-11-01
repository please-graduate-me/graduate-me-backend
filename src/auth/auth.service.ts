import { Inject, Injectable, Logger } from '@nestjs/common';
import { getSession, type ExpressAuthConfig } from '@auth/express';
import Google from '@auth/express/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service.js';
@Injectable()
/** 세션과 OAuth 설정이 여러 API에서 다르게 적용되지 않게 한다. */
export class AuthService {
  readonly config: ExpressAuthConfig;
  private readonly logger = new Logger(AuthService.name);
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {
    this.config = {
      basePath: '/api/auth',
      trustHost: true,
      secret: process.env.AUTH_SECRET,
      adapter: PrismaAdapter(this.db),
      providers: [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
        }),
      ],
      session: { strategy: 'database' },
      pages: { signIn: '/', error: '/' },
      logger: {
        // 공개 주소와 인증 경로를 함께 지정하므로 이 중복 안내는 예상된 설정이다.
        warn: (code) => {
          if (code !== 'env-url-basepath-redundant') this.logger.warn(code);
        },
        error: (error) => this.logger.error(error.name),
      },
      callbacks: {
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
  async session(request: Request) {
    return this.configured ? getSession(request, this.config) : null;
  }
}
