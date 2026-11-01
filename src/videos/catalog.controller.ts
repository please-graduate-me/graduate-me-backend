import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { publicVideoQuerySchema } from '@graduate-me/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CatalogService } from './catalog.service.js';

@Controller('catalog')
@UseGuards(AuthGuard)
/** 로그인한 사용자만 공용 영상 목록을 탐색하게 한다. */
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService
  ) {}
  @Get('videos')
  videos(@Query() query: unknown) {
    return this.catalog.list(publicVideoQuerySchema.parse(query));
  }
  @Get('categories')
  categories() {
    return this.catalog.categories();
  }
}
