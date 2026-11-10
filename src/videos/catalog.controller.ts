import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { publicVideoQuerySchema } from './catalog-contracts.js';
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import { CatalogService } from './catalog.service.js';

/** 로그인한 사용자만 공용 영상 목록을 탐색하게 한다. */
@Controller('catalog')
@UseGuards(AuthGuard)
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService
  ) {}
  @Get('videos')
  videos(@Query() query: unknown, @Req() request: UserRequest) {
    return this.catalog.list(
      publicVideoQuerySchema.parse(query),
      request.userId
    );
  }
  @Get('categories')
  categories(@Req() request: UserRequest) {
    return this.catalog.categories(request.userId);
  }
}
