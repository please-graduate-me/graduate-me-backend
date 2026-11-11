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
import { analysisQuerySchema, analysisRetrySchema } from './contracts.js';
import { MaterialAnalysisService } from './material-analysis.service.js';

/** 결과 조회는 생성을 시작하지 않고 재요청은 소유자 권한으로 분리한다. */
@Controller('materials/:id/analysis')
@UseGuards(AuthGuard)
export class MaterialAnalysisController {
  constructor(
    @Inject(MaterialAnalysisService)
    private readonly analysis: MaterialAnalysisService
  ) {}
  @Get()
  get(
    @Req() request: UserRequest,
    @Param('id') id: string,
    @Query() query: unknown
  ) {
    return this.analysis.get(
      request.userId,
      id,
      analysisQuerySchema.parse(query).version
    );
  }
  @Post('retry')
  @HttpCode(200)
  retry(
    @Req() request: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const input = analysisRetrySchema.parse(body);

    return this.analysis.retry(
      request.userId,
      id,
      input.version,
      input.requestId
    );
  }
}
