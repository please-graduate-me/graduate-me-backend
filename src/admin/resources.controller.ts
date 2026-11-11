import {
  Body,
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
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import type { UserRequest } from '../auth/auth.guard.js';
import { MaterialsService } from '../learning/materials.service.js';
import { materialInputSchema } from '../learning/contracts.js';
import { materialPolicy } from '../learning/material-policy.js';
import { VideosService } from '../videos/videos.service.js';
import { registerVideoSchema } from '../videos/contracts.js';
import { OcrService } from '../ocr/ocr.service.js';
import { ocrInputSchema, ocrQuerySchema } from '../ocr/contracts.js';

/** 전용 운영 세션에서도 기존 자료 정책과 원본 소유권 검사를 그대로 적용한다. */
@Controller('admin/resources')
@UseGuards(AdminAuthGuard)
export class AdminResourcesController {
  constructor(
    @Inject(MaterialsService) private readonly materials: MaterialsService,
    @Inject(VideosService) private readonly videos: VideosService,
    @Inject(OcrService) private readonly ocr: OcrService
  ) {}
  @Get('policy') policy() {
    return materialPolicy();
  }
  @Post('materials') @HttpCode(200) create(
    @Req() r: UserRequest,
    @Body() body: unknown
  ) {
    return this.materials.create(r.userId, materialInputSchema.parse(body));
  }
  @Post('videos') @HttpCode(200) register(
    @Req() r: UserRequest,
    @Body() body: unknown
  ) {
    const { url, language } = registerVideoSchema.parse(body);

    return this.videos.registerVideo(r.userId, url, language);
  }
  @Get('materials/:id/ocr') getOcr(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Query() query: unknown
  ) {
    return this.ocr.get(r.userId, id, ocrQuerySchema.parse(query));
  }
  @Post('materials/:id/ocr') @HttpCode(200) recognize(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.ocr.recognize(r.userId, id, ocrInputSchema.parse(body));
  }
}
