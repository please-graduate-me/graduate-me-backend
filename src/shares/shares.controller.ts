import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createShareSchema, shareVisitSchema } from './contracts.js';
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import { SharesService } from './shares.service.js';

@Controller('shares')
@UseGuards(AuthGuard)
/** 공유 조회·집계·학습 시작 모두 로그인한 사용자에게만 허용한다. */
export class SharesController {
  constructor(@Inject(SharesService) private readonly shares: SharesService) {}
  @Post()
  @HttpCode(200)
  create(@Req() request: UserRequest, @Body() body: unknown) {
    return this.shares.create(request.userId, createShareSchema.parse(body));
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.shares.get(id);
  }
  @Post(':id/visits')
  @HttpCode(200)
  visit(@Param('id') id: string, @Body() body: unknown) {
    return this.shares.visit(id, shareVisitSchema.parse(body).visitId);
  }
  @Post(':id/start')
  @HttpCode(200)
  start(
    @Req() request: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.shares.start(
      request.userId,
      id,
      shareVisitSchema.parse(body).visitId
    );
  }
}
