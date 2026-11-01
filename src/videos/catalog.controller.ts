import { Controller, Get, Inject, Query } from '@nestjs/common';
import { publicVideoQuerySchema } from '@graduate-me/shared';
import { CatalogService } from './catalog.service.js';

@Controller('catalog')
/** 로그인 전 홈에서도 준비된 공용 영상을 탐색하게 한다. */
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
