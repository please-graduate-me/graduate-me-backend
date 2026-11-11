import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AdminAuthService } from './admin-auth.service.js';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(256),
});

/** 운영 인증에는 사용자 OAuth나 클라이언트가 지정한 복귀 주소를 사용하지 않는다. */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    @Inject(AdminAuthService) private readonly auth: AdminAuthService
  ) {}
  @Get('status') status(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');

    return { configured: this.auth.configured };
  }
  @Post('login') @HttpCode(200) login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown
  ) {
    response.setHeader('Cache-Control', 'no-store');
    const input = loginSchema.parse(body);

    return this.auth.login(request, response, input.username, input.password);
  }
  @Post('logout') @HttpCode(200) logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.auth.logout(request, response);
  }
}
