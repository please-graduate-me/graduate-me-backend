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
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import { ocrInputSchema, ocrQuerySchema } from './contracts.js';
import { OcrService } from './ocr.service.js';

/** 저장 결과 조회와 명시적 유료 인식 요청을 구분한다. */
@Controller('materials/:id/ocr')
@UseGuards(AuthGuard)
export class OcrController {
  constructor(@Inject(OcrService) private readonly ocr: OcrService) {}
  @Get()
  get(
    @Req() request: UserRequest,
    @Param('id') id: string,
    @Query() query: unknown
  ) {
    return this.ocr.get(request.userId, id, ocrQuerySchema.parse(query));
  }
  @Post()
  @HttpCode(200)
  recognize(
    @Req() request: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.ocr.recognize(request.userId, id, ocrInputSchema.parse(body));
  }
}
