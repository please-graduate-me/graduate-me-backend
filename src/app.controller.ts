import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthService } from './auth/auth.service.js';

@Controller()
/** 클라이언트가 서버 준비 상태를 인증 없이 확인할 수 있게 한다. */
export class AppController {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(AuthService) private readonly auth: AuthService
  ) {}
  @Get('health')
  async health() {
    try {
      await this.db.query('SELECT 1');

      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
  @Get('auth-status')
  authStatus() {
    return { configured: this.auth.configured };
  }
}
