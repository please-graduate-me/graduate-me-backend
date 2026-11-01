import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { PrismaService } from './database/prisma.service.js';
import { AuthService } from './auth/auth.service.js';
import { AuthGuard } from './auth/auth.guard.js';
import { VideosController } from './videos/videos.controller.js';
import { VideosService } from './videos/videos.service.js';
import { CatalogController } from './videos/catalog.controller.js';
import { CatalogService } from './videos/catalog.service.js';
@Module({
  controllers: [AppController, VideosController, CatalogController],
  providers: [
    PrismaService,
    AuthService,
    AuthGuard,
    VideosService,
    CatalogService,
  ],
})
/** API 기능의 의존성을 하나의 서버 진입점에서 조립한다. */
export class AppModule {}
