import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { UserRequest } from '../auth/auth.guard.js';
import { WorkspaceAccessService } from './workspace-access.service.js';

/** admin UI 진입과 별개로 작업 API의 역할 권한을 검사한다. */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    @Inject(WorkspaceAccessService)
    private readonly access: WorkspaceAccessService
  ) {}
  async canActivate(context: ExecutionContext) {
    await this.access.require(
      context.switchToHttp().getRequest<UserRequest>().userId
    );

    return true;
  }
}
