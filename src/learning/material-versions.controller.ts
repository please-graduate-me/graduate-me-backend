import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import {
  MaterialsService,
  materialVersionInputSchema,
} from './materials.service.js';

/** 원본 교체를 별도 버전으로 저장하고 권한이 있는 계정에만 과거 파일을 제공한다. */
@Controller('materials')
@UseGuards(AuthGuard)
export class MaterialVersionsController {
  constructor(
    @Inject(MaterialsService) private readonly materials: MaterialsService
  ) {}
  @Get(':id/versions')
  @Header('Cache-Control', 'private, no-store')
  versions(@Req() r: UserRequest, @Param('id') id: string) {
    return this.materials.versions(r.userId, id);
  }
  @Post(':id/versions')
  @HttpCode(200)
  replace(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.materials.replace(
      r.userId,
      id,
      materialVersionInputSchema.parse(body)
    );
  }
  @Get(':id/versions/:version/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async file(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Param('version') version: string
  ) {
    const material = await this.materials.file(
      r.userId,
      id,
      z.coerce.number().int().positive().parse(version)
    );

    return new StreamableFile(material.content, {
      type: 'application/pdf',
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(material.filename)}`,
      length: material.content.length,
    });
  }
}
