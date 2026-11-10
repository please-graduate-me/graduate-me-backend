import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import { AdminGuard } from './admin.guard.js';
import { WorkspaceGuard } from './workspace.guard.js';
import { WorkspaceAccessService } from './workspace-access.service.js';
import { WorkspaceQuestionsService } from './workspace-questions.service.js';
import { WorkspaceOperationsService } from './workspace-operations.service.js';
import { messageInputSchema } from '../learning/contracts.js';
import {
  assignInputSchema,
  draftInputSchema,
  helperInputSchema,
  resolutionInputSchema,
  reviewInputSchema,
  questionListQuerySchema,
  historyQuerySchema,
  processingUsageQuerySchema,
  moderationInputSchema,
} from './workspace-contracts.js';

/** 도우미 작업과 운영자 전용 관리를 서버 권한 경계로 분리한다. */
@Controller('admin/workspace')
@UseGuards(AuthGuard)
export class WorkspaceController {
  constructor(
    @Inject(WorkspaceAccessService)
    private readonly access: WorkspaceAccessService,
    @Inject(WorkspaceQuestionsService)
    private readonly questions: WorkspaceQuestionsService,
    @Inject(WorkspaceOperationsService)
    private readonly operations: WorkspaceOperationsService
  ) {}
  @Get('access')
  workspaceAccess(@Req() r: UserRequest) {
    return this.access.access(r.userId);
  }
  @Get('questions')
  @UseGuards(WorkspaceGuard)
  list(@Req() r: UserRequest, @Query() query: unknown) {
    return this.questions.list(r.userId, questionListQuerySchema.parse(query));
  }
  @Get('questions/:id')
  @UseGuards(WorkspaceGuard)
  detail(@Req() r: UserRequest, @Param('id') id: string) {
    return this.questions.detail(r.userId, id);
  }
  @Patch('questions/:id')
  @UseGuards(WorkspaceGuard)
  draft(@Req() r: UserRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.questions.saveDraft(r.userId, id, draftInputSchema.parse(body));
  }
  @Post('questions/:id/answer')
  @HttpCode(200)
  @UseGuards(WorkspaceGuard)
  answer(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.questions.answer(
      r.userId,
      id,
      messageInputSchema.parse(body).body
    );
  }
  @Post('questions/:id/assign')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  assign(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.questions.assign(
      r.userId,
      id,
      assignInputSchema.parse(body).assigneeId
    );
  }
  @Post('questions/:id/reviews')
  @HttpCode(200)
  @UseGuards(WorkspaceGuard)
  requestReview(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.questions.requestReview(
      r.userId,
      id,
      reviewInputSchema.parse(body)
    );
  }
  @Get('reviews')
  @UseGuards(WorkspaceGuard)
  reviews(@Req() r: UserRequest, @Query() query: unknown) {
    return this.questions.reviews(r.userId, historyQuerySchema.parse(query));
  }
  @Get('reviews/:id')
  @UseGuards(WorkspaceGuard)
  review(@Req() r: UserRequest, @Param('id') id: string) {
    return this.questions.review(r.userId, id);
  }
  @Post('reviews/:id/resolve')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  resolve(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.questions.resolve(
      r.userId,
      id,
      resolutionInputSchema.parse(body)
    );
  }
  @Get('events')
  @UseGuards(WorkspaceGuard)
  events(@Req() r: UserRequest, @Query() query: unknown) {
    return this.questions.events(r.userId, historyQuerySchema.parse(query));
  }
  @Get('overview')
  @UseGuards(AdminGuard)
  overview() {
    return this.operations.overview();
  }
  @Get('materials')
  @UseGuards(AdminGuard)
  materials(@Query() query: unknown) {
    return this.operations.materials(historyQuerySchema.parse(query));
  }
  @Get('helpers')
  @UseGuards(AdminGuard)
  helpers() {
    return this.operations.helpers();
  }
  @Post('helpers')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  saveHelper(@Req() r: UserRequest, @Body() body: unknown) {
    return this.operations.saveHelper(r.userId, helperInputSchema.parse(body));
  }
  @Get('usage')
  @UseGuards(AdminGuard)
  usage(@Query() query: unknown) {
    return this.operations.usage(processingUsageQuerySchema.parse(query));
  }
  @Get('community-reports')
  @UseGuards(AdminGuard)
  communityReports(@Query() query: unknown) {
    return this.operations.communityReports(historyQuerySchema.parse(query));
  }
  @Post('community-reports/:id/resolve')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  moderate(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.operations.moderate(
      r.userId,
      id,
      moderationInputSchema.parse(body)
    );
  }
}
