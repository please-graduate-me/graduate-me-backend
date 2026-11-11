import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { UserRequest } from '../auth/auth.guard.js';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import { AdminGuard } from './admin.guard.js';
import {
  MaterialAccessService,
  materialAccessInputSchema,
} from './material-access.service.js';

/** 운영자 전용 자료 공개 설정에도 소유권과 기존 공개 여부를 재검사한다. */
@Controller('admin/workspace/materials')
@UseGuards(AdminAuthGuard, AdminGuard)
export class MaterialAccessController {
  constructor(
    @Inject(MaterialAccessService)
    private readonly access: MaterialAccessService
  ) {}
  @Get(':id/access')
  get(@Param('id') id: string, @Query('kind') kind: unknown) {
    return this.access.get(id, z.enum(['pdf', 'video']).parse(kind));
  }
  @Patch(':id/access')
  update(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.access.update(
      r.userId,
      id,
      materialAccessInputSchema.parse(body)
    );
  }
}
