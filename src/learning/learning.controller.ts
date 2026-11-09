import { materialPolicy } from './material-policy.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SourceService } from './source.service.js';
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import { MaterialsService } from './materials.service.js';
import { ExpressionsService } from './expressions.service.js';
import { QuestionsService } from './questions.service.js';
import { LearningService } from './learning.service.js';
import {
  expressionInputSchema,
  expressionUpdateSchema,
  materialInputSchema,
  materialUpdateSchema,
  messageInputSchema,
  practiceInputSchema,
  questionInputSchema,
  recipientsQuerySchema,
  questionStateSchema,
  expressionQuerySchema,
} from './contracts.js';

@Controller()
@UseGuards(AuthGuard)
/** 학생 원문 학습의 입력을 검증하고 계정 식별자는 인증 세션에서 받는다. */
export class LearningController {
  constructor(
    @Inject(MaterialsService) private readonly materials: MaterialsService,
    @Inject(ExpressionsService)
    private readonly expressions: ExpressionsService,
    @Inject(QuestionsService) private readonly questions: QuestionsService,
    @Inject(LearningService) private readonly learning: LearningService,
    @Inject(SourceService) private readonly sources: SourceService
  ) {}
  @Get('learning/policy')
  policy() {
    return materialPolicy();
  }
  @Get('materials')
  materialsList(@Req() r: UserRequest) {
    return this.materials.list(r.userId);
  }
  @Post('materials')
  @HttpCode(200)
  materialCreate(@Req() r: UserRequest, @Body() body: unknown) {
    return this.materials.create(r.userId, materialInputSchema.parse(body));
  }
  @Get('materials/:id/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async materialFile(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Query('version') version?: string
  ) {
    const material = await this.materials.file(
      r.userId,
      id,
      version === undefined
        ? undefined
        : z.coerce.number().int().positive().parse(version)
    );

    return new StreamableFile(material.content, {
      type: 'application/pdf',
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(material.filename)}`,
      length: material.content.length,
    });
  }
  @Get('materials/:id')
  material(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Query('version') version?: string
  ) {
    return this.materials.get(
      r.userId,
      id,
      version === undefined
        ? undefined
        : z.coerce.number().int().positive().parse(version)
    );
  }
  @Patch('materials/:id')
  materialUpdate(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.materials.update(
      r.userId,
      id,
      materialUpdateSchema.parse(body)
    );
  }
  @Delete('materials/:id')
  materialRemove(@Req() r: UserRequest, @Param('id') id: string) {
    return this.materials.remove(r.userId, id);
  }
  @Get('expressions')
  expressionsList(@Req() r: UserRequest, @Query() query: unknown) {
    return this.expressions.list(r.userId, expressionQuerySchema.parse(query));
  }
  @Post('expressions')
  @HttpCode(200)
  expressionCreate(@Req() r: UserRequest, @Body() body: unknown) {
    return this.expressions.create(r.userId, expressionInputSchema.parse(body));
  }
  @Patch('expressions/:id')
  expressionUpdate(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.expressions.update(
      r.userId,
      id,
      expressionUpdateSchema.parse(body)
    );
  }
  @Delete('expressions/:id')
  expressionRemove(@Req() r: UserRequest, @Param('id') id: string) {
    return this.expressions.remove(r.userId, id);
  }
  @Get('questions')
  questionsList(@Req() r: UserRequest) {
    return this.questions.list(r.userId);
  }
  @Get('questions/recipients')
  recipients(@Req() r: UserRequest, @Query() query: unknown) {
    return this.questions.recipients(
      r.userId,
      recipientsQuerySchema.parse(query)
    );
  }
  @Post('questions')
  @HttpCode(200)
  questionCreate(@Req() r: UserRequest, @Body() body: unknown) {
    return this.questions.create(r.userId, questionInputSchema.parse(body));
  }
  @Get('questions/:id')
  question(@Req() r: UserRequest, @Param('id') id: string) {
    return this.questions.get(r.userId, id);
  }
  @Patch('questions/:id')
  questionState(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.questions.updateState(
      r.userId,
      id,
      questionStateSchema.parse(body)
    );
  }
  @Post('questions/:id/messages')
  @HttpCode(200)
  followUp(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.questions.followUp(
      r.userId,
      id,
      messageInputSchema.parse(body).body
    );
  }
  @Post('practice/attempts')
  @HttpCode(200)
  practice(@Req() r: UserRequest, @Body() body: unknown) {
    return this.expressions.practice(r.userId, practiceInputSchema.parse(body));
  }
  @Get('learning/video-source/:videoId/:segmentId')
  videoSource(
    @Req() r: UserRequest,
    @Param('videoId') videoId: string,
    @Param('segmentId') segmentId: string,
    @Query('version') version: string
  ) {
    return this.sources.videoArchive(
      r.userId,
      videoId,
      segmentId,
      z.coerce.number().int().positive().parse(version)
    );
  }
  @Get('learning/summary')
  summary(@Req() r: UserRequest) {
    return this.learning.summary(r.userId);
  }
  @Get('learning/history')
  history(@Req() r: UserRequest) {
    return this.learning.history(r.userId);
  }
}
