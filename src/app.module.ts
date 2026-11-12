import { GrowthController } from './growth/growth.controller.js';
import { GrowthService } from './growth/growth.service.js';
import { MaterialAnalysisController } from './material-analysis/material-analysis.controller.js';
import { MaterialAnalysisService } from './material-analysis/material-analysis.service.js';
import { MaterialAnalysisProcessor } from './material-analysis/material-analysis.processor.js';
import { MaterialAnalysisRunner } from './material-analysis/material-analysis.runner.js';
import { LearningHistoryService } from './ai/learning-history.service.js';
import { PersonalizationService } from './insights/personalization.service.js';
import { CommunityController } from './community/community.controller.js';
import { CommunityService } from './community/community.service.js';
import { CoursesController } from './courses/courses.controller.js';
import { CoursesService } from './courses/courses.service.js';
import { InsightsController } from './insights/insights.controller.js';
import { InsightsService } from './insights/insights.service.js';
import { ClovaProviderService } from './ai/clova-provider.service.js';
import { AnthropicProviderService } from './ai/anthropic-provider.service.js';
import { OcrController } from './ocr/ocr.controller.js';
import { OcrService } from './ocr/ocr.service.js';
import { OcrProviderService } from './ocr/ocr-provider.service.js';
import { ClovaOcrProviderService } from './ocr/clova-ocr-provider.service.js';
import { ClaudeOcrProviderService } from './ocr/claude-ocr-provider.service.js';
import { PdfRasterizerService } from './ocr/pdf-rasterizer.service.js';
import { DemoController } from './videos/demo.controller.js';
import { AdminAuthController } from './auth/admin-auth.controller.js';
import { AdminAuthService } from './auth/admin-auth.service.js';
import { AdminAuthGuard } from './auth/admin-auth.guard.js';
import { AdminResourcesController } from './admin/resources.controller.js';
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
import { AIController } from './ai/ai.controller.js';
import { ProviderService } from './ai/provider.service.js';
import { UsageService } from './ai/usage.service.js';
import { OperationService } from './ai/operation.service.js';
import { ArtifactService } from './ai/artifact.service.js';
import { LearningAIService } from './ai/learning-ai.service.js';
import { ConversationService } from './ai/conversation.service.js';
import { PracticeService } from './ai/practice.service.js';
import { ProfileController } from './users/profile.controller.js';
import { ProfileService } from './users/profile.service.js';
import { RecordsController } from './learning/records.controller.js';
import { RecordsService } from './learning/records.service.js';
import { ContentController } from './admin/content.controller.js';
import { ContentService } from './admin/content.service.js';
import { MaterialVersionsController } from './learning/material-versions.controller.js';
import { MaterialAccessController } from './admin/material-access.controller.js';
import { MaterialAccessService } from './admin/material-access.service.js';

/** API 기능의 의존성을 하나의 서버 진입점에서 조립한다. */
@Module({
  imports: [TypeOrmModule.forRoot(databaseOptions())],
  controllers: [
    GrowthController,
    AdminResourcesController,
    AdminAuthController,
    MaterialAnalysisController,
    CommunityController,
    CoursesController,
    InsightsController,
    OcrController,
    AppController,
    DemoController,
    VideosController,
    CatalogController,
    SettingsController,
    SharesController,
    AdminController,
    LearningController,
    WorkspaceController,
    AIController,
    ProfileController,
    RecordsController,
    ContentController,
    MaterialVersionsController,
    MaterialAccessController,
  ],
  providers: [
    GrowthService,
    AdminAuthService,
    AdminAuthGuard,
    MaterialAnalysisService,
    MaterialAnalysisProcessor,
    MaterialAnalysisRunner,
    LearningHistoryService,
    PersonalizationService,
    CommunityService,
    CoursesService,
    InsightsService,
    OcrService,
    OcrProviderService,
    ClovaOcrProviderService,
    ClaudeOcrProviderService,
    PdfRasterizerService,
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
    ProviderService,
    ClovaProviderService,
    AnthropicProviderService,
    UsageService,
    OperationService,
    ArtifactService,
    LearningAIService,
    ConversationService,
    PracticeService,
    ProfileService,
    RecordsService,
    ContentService,
    MaterialAccessService,
  ],
})
export class AppModule {}
