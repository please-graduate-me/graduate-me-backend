import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { adminShareQuerySchema } from './contracts.js';
import type { UserRequest } from '../auth/auth.guard.js';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import { AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';

/** 권한 확인 외의 운영 데이터는 관리자에게만 제공한다. */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  @Get('access')
  async access(@Req() request: UserRequest) {
    return { allowed: await this.admin.allowed(request.userId) };
  }
  @Get('shares')
  @UseGuards(AdminGuard)
  shares(@Query() query: unknown) {
    return this.admin.shares(adminShareQuerySchema.parse(query));
  }
  @Post('shares/:id/revoke')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  revoke(@Param('id') id: string) {
    return this.admin.revoke(id);
  }
}
