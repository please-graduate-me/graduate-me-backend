import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import { GrowthService } from './growth.service.js';

const preferencesSchema = z
  .object({
    nickname: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .regex(/^[\p{L}\p{N} _.-]+$/u),
    participating: z.boolean(),
  })
  .strict();

/** 보상 수령을 클라이언트에 맡기지 않고 개인 현황과 선택 공개만 제공한다. */
@Controller('growth')
@UseGuards(AuthGuard)
export class GrowthController {
  constructor(@Inject(GrowthService) private readonly growth: GrowthService) {}
  @Get() summary(@Req() r: UserRequest) {
    return this.growth.summary(r.userId);
  }
  @Get('leaderboard') leaderboard(@Req() r: UserRequest) {
    return this.growth.leaderboard(r.userId);
  }
  @Patch('preferences') preferences(
    @Req() r: UserRequest,
    @Body() body: unknown
  ) {
    const value = preferencesSchema.parse(body);

    return this.growth.preferences(
      r.userId,
      value.nickname,
      value.participating
    );
  }
}
