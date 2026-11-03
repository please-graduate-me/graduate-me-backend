import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { HttpError } from '../common/http-error.js';

/** 사용자 식별자는 클라이언트 입력 대신 인증 가드가 보장한다. */
export type UserRequest = Request & { userId: string };

@Injectable()
/** 세션과 요청 출처를 함께 검사해 다른 계정의 상태 변경을 막는다. */
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<UserRequest>();
    const session = await this.auth.session(request);

    if (!session?.user?.id) throw new HttpError(401, '로그인이 필요합니다.');

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = new URL(process.env.AUTH_URL || 'http://localhost:3000')
        .origin;

      if (request.headers.origin !== origin)
        throw new HttpError(403, '요청 출처를 확인할 수 없습니다.');
    }

    request.userId = session.user.id;

    return true;
  }
}
