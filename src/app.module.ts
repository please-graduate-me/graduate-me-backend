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
import { LearningController } from './learning/learning.controller.js';
import { SourceService } from './learning/source.service.js';
import { MaterialsService } from './learning/materials.service.js';
import { ExpressionsService } from './learning/expressions.service.js';
import { QuestionsService } from './learning/questions.service.js';
import { LearningService } from './learning/learning.service.js';
import { WorkspaceController } from './admin/workspace.controller.js';
import { WorkspaceAccessService } from './admin/workspace-access.service.js';
import { WorkspaceGuard } from './admin/workspace.guard.js';
import { WorkspaceQuestionsService } from './admin/workspace-questions.service.js';
import { WorkspaceOperationsService } from './admin/workspace-operations.service.js';

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
    LearningController,
    WorkspaceController,
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
    SourceService,
    MaterialsService,
    ExpressionsService,
    QuestionsService,
    LearningService,
    WorkspaceAccessService,
    WorkspaceGuard,
    WorkspaceQuestionsService,
    WorkspaceOperationsService,
  ],
})
/** API 기능의 의존성을 하나의 서버 진입점에서 조립한다. */
export class AppModule {}
