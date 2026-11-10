import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AuthService } from './auth/auth.service.js';
import { normalizeAuthOrigin } from './auth/request-origin.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.setGlobalPrefix('api');
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(normalizeAuthOrigin);

  // PDF 원본의 base64 전송만 큰 본문을 허용해 일반 변경 요청의 크기와 분리한다.
  app.use(
    '/api/materials',
    (
      request: express.Request,
      response: express.Response,
      next: express.NextFunction
    ) => {
      if (
        request.method === 'POST' &&
        (request.path === '/' || /^\/[^/]+\/versions\/?$/.test(request.path))
      )
        return express.json({ limit: '32mb' })(request, response, next);
      next();
    }
  );

  app.use('/api/ai/explanations', express.json({ limit: '8mb' }));
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  const auth = app.get(AuthService);

  const authHandler: express.RequestHandler = (request, response, next) =>
    auth.handle(request, response, next);

  app.use(/^\/api\/auth\/(.*)$/, authHandler);

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
