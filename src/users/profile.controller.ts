import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import { ProfileService, profileInputSchema } from './profile.service.js';

@Controller('me')
@UseGuards(AuthGuard)
/** 본인 프로필 변경과 명시적인 계정 탈퇴만 허용한다. */
export class ProfileController {
  constructor(
    @Inject(ProfileService) private readonly profiles: ProfileService
  ) {}
  @Get('profile')
  @Header('Cache-Control', 'private, no-store')
  get(@Req() request: UserRequest) {
    return this.profiles.get(request.userId);
  }
  @Patch('profile')
  update(@Req() request: UserRequest, @Body() body: unknown) {
    return this.profiles.update(request.userId, profileInputSchema.parse(body));
  }
  @Delete('account')
  remove(@Req() request: UserRequest, @Body() body: unknown) {
    z.object({ confirmation: z.literal('DELETE') }).parse(body);

    return this.profiles.remove(request.userId);
  }
}
