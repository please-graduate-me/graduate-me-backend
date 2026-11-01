import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { learningSettingsSchema } from '@graduate-me/shared';
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import { SettingsService } from './settings.service.js';

@Controller('me/settings')
@UseGuards(AuthGuard)
/** 다른 계정의 옵션을 변경할 수 없도록 세션의 사용자만 사용한다. */
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService
  ) {}
  @Get()
  get(@Req() request: UserRequest) {
    return this.settings.get(request.userId);
  }
  @Post()
  @HttpCode(200)
  update(@Req() request: UserRequest, @Body() body: unknown) {
    return this.settings.update(
      request.userId,
      learningSettingsSchema.parse(body)
    );
  }
}
