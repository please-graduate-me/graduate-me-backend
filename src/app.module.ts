import { DemoController } from './videos/demo.controller.js';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './database/options.js';
import { AuthService } from './auth/auth.service.js';
import { AuthGuard } from './auth/auth.guard.js';
import { VideosController } from './videos/videos.controller.js';
import { VideosService } from './videos/videos.service.js';
import { CatalogController } from './videos/catalog.controller.js';
import { CatalogService } from './videos/catalog.service.js';
import { SettingsController } from './users/settings.controller.js';
import { SettingsService } from './users/settings.service.js';
import { SharesController } from './shares/shares.controller.js';
import { SharesService } from './shares/shares.service.js';
import { AdminController } from './admin/admin.controller.js';
import { AdminService } from './admin/admin.service.js';
import { AdminGuard } from './admin/admin.guard.js';

@Module({
  imports: [TypeOrmModule.forRoot(databaseOptions())],
  controllers: [
    AppController,
    DemoController,
    VideosController,
    CatalogController,
    SettingsController,
    SharesController,
    AdminController,
  ],
  providers: [
    AuthService,
    AuthGuard,
    VideosService,
    CatalogService,
    SettingsService,
    SharesService,
    AdminService,
    AdminGuard,
  ],
})
/** API 기능의 의존성을 하나의 서버 진입점에서 조립한다. */
export class AppModule {}
