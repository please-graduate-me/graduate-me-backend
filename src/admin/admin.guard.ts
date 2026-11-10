import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { UserRequest } from '../auth/auth.guard.js';
import { HttpError } from '../common/http-error.js';
import { AdminService } from './admin.service.js';

/** 화면 노출 여부와 별개로 관리자 API 접근을 서버에서 차단한다. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<UserRequest>();

    if (!(await this.admin.allowed(request.userId)))
      throw new HttpError(403, '관리자만 접근할 수 있습니다.');

    return true;
  }
}
