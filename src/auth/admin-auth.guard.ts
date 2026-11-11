import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { UserRequest } from './auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import { HttpError } from '../common/http-error.js';

/** 일반 Google 로그인과 조교 자격으로는 운영 API를 호출할 수 없다. */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    @Inject(AdminAuthService) private readonly auth: AdminAuthService
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<UserRequest>();

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
      this.auth.assertOrigin(request);
    const userId = await this.auth.session(request);

    if (!userId) throw new HttpError(401, '운영자 로그인이 필요합니다.');

    context
      .switchToHttp()
      .getResponse()
      .setHeader('Cache-Control', 'private, no-store');

    request.userId = userId;

    return true;
  }
}
