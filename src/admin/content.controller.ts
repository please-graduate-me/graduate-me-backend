import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import { WorkspaceGuard } from './workspace.guard.js';
import { AdminGuard } from './admin.guard.js';
import { ContentService } from './content.service.js';
import { UsageService } from '../ai/usage.service.js';
import {
  contentReviewSchema,
  revisionInputSchema,
  visibilityInputSchema,
} from '../ai/contracts.js';

const querySchema = z.object({ questionId: z.uuid() });

/** 실제 수정·검토와 사용량 조회에 자료별·역할별 권한을 적용한다. */
@Controller('admin/workspace')
@UseGuards(AuthGuard, WorkspaceGuard)
export class ContentController {
  constructor(
    @Inject(ContentService) private readonly content: ContentService,
    @Inject(UsageService) private readonly usage: UsageService
  ) {}
  @Get('content') list(@Req() r: UserRequest, @Query() q: unknown) {
    return this.content.list(r.userId, querySchema.parse(q).questionId);
  }
  @Get('content/:kind/:id/versions') versions(
    @Req() r: UserRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query() q: unknown
  ) {
    return this.content.versions(
      r.userId,
      kind,
      id,
      querySchema.parse(q).questionId
    );
  }
  @Post('content/:kind/:id/revisions') @HttpCode(200) revise(
    @Req() r: UserRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.content.revise(
      r.userId,
      kind,
      id,
      revisionInputSchema.parse(body)
    );
  }
  @Post('content/:kind/:id/review') @HttpCode(200) review(
    @Req() r: UserRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.content.review(
      r.userId,
      kind,
      id,
      contentReviewSchema.parse(body)
    );
  }
  @Post('content/practice/:id/visibility') @HttpCode(200) visibility(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.content.visibility(
      r.userId,
      id,
      visibilityInputSchema.parse(body)
    );
  }
  @Get('content/:kind/:id/impact') impact(
    @Req() r: UserRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query() q: unknown
  ) {
    return this.content.impact(
      r.userId,
      kind,
      id,
      querySchema.parse(q).questionId
    );
  }
  @Get('ai-usage') @UseGuards(AdminGuard) usageReport() {
    return this.usage.report();
  }
}
