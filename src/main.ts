import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAuth } from '@auth/express';
import express from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AuthService } from './auth/auth.service.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.setGlobalPrefix('api');
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  const publicURL = new URL(process.env.AUTH_URL || 'http://localhost:3000');
  // 내부 프록시 주소 대신 고정된 공개 주소로 인증 콜백을 생성한다.
  app.use(
    (
      request: express.Request,
      _response: express.Response,
      next: express.NextFunction
    ) => {
      request.headers.host = publicURL.host;
      request.headers['x-forwarded-host'] = publicURL.host;
      request.headers['x-forwarded-proto'] = publicURL.protocol.slice(0, -1);
      next();
    }
  );
  app.use(express.json({ limit: '16kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(/^\/api\/auth\/(.*)$/, ExpressAuth(app.get(AuthService).config));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT || 4000), '0.0.0.0');
}
bootstrap().catch((error) => {
  console.error(
    'API 서버 시작 실패',
    error instanceof Error ? error.message : '알 수 없는 오류'
  );
  process.exitCode = 1;
});
