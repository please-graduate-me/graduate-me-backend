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
import { LearningAIService } from './learning-ai.service.js';
import { ConversationService } from './conversation.service.js';
import { ArtifactService } from './artifact.service.js';
import { PracticeService } from './practice.service.js';
import {
  chatInputSchema,
  conversationInputSchema,
  explanationInputSchema,
  preparationSchema,
  sourceQuerySchema,
  practiceGenerateSchema,
  exerciseStateSchema,
  exerciseVersionSchema,
  exerciseAnswerSchema,
} from './contracts.js';

/** 저장 결과 조회와 명시적 AI 실행·연습 채점을 서로 다른 경로로 제공한다. */
@Controller()
@UseGuards(AuthGuard)
export class AIController {
  constructor(
    @Inject(LearningAIService) private readonly ai: LearningAIService,
    @Inject(ConversationService)
    private readonly conversations: ConversationService,
    @Inject(ArtifactService) private readonly artifacts: ArtifactService,
    @Inject(PracticeService) private readonly practice: PracticeService
  ) {}
  @Get('ai/capabilities') capabilities() {
    return this.ai.capabilities();
  }
  @Get('ai/explanations') explanations(
    @Req() r: UserRequest,
    @Query() q: unknown
  ) {
    return this.artifacts.list(
      r.userId,
      'explanation',
      sourceQuerySchema.parse(q)
    );
  }
  @Post('ai/explanations') @HttpCode(200) explain(
    @Req() r: UserRequest,
    @Body() body: unknown
  ) {
    return this.ai.explain(r.userId, explanationInputSchema.parse(body));
  }
  @Post('materials/:id/prepare') @HttpCode(200) prepare(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.ai.prepare(r.userId, id, preparationSchema.parse(body));
  }
  @Get('ai/artifacts/:id') artifact(
    @Req() r: UserRequest,
    @Param('id') id: string
  ) {
    return this.artifacts.get(r.userId, id);
  }
  @Get('ai/conversations') conversationList(
    @Req() r: UserRequest,
    @Query() q: unknown
  ) {
    return this.conversations.list(r.userId, sourceQuerySchema.parse(q));
  }
  @Post('ai/conversations') @HttpCode(200) open(
    @Req() r: UserRequest,
    @Body() body: unknown
  ) {
    return this.conversations.open(
      r.userId,
      conversationInputSchema.parse(body).source
    );
  }
  @Get('ai/conversations/:id') conversation(
    @Req() r: UserRequest,
    @Param('id') id: string
  ) {
    return this.conversations.get(r.userId, id);
  }
  @Post('ai/conversations/:id/messages') @HttpCode(200) message(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const input = chatInputSchema.parse(body);

    return this.conversations.message(
      r.userId,
      id,
      input.requestId,
      input.text
    );
  }
  @Get('ai/practice') practiceList(@Req() r: UserRequest, @Query() q: unknown) {
    return this.artifacts.list(
      r.userId,
      'practice',
      sourceQuerySchema.parse(q)
    );
  }
  @Post('ai/practice/generate') @HttpCode(200) generate(
    @Req() r: UserRequest,
    @Body() body: unknown
  ) {
    return this.practice.generate(r.userId, practiceGenerateSchema.parse(body));
  }
  @Patch('ai/practice/:id/state') state(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.practice.updateState(
      r.userId,
      id,
      exerciseStateSchema.parse(body)
    );
  }
  @Post('ai/practice/:id/hint') @HttpCode(200) hint(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.practice.reveal(
      r.userId,
      id,
      exerciseVersionSchema.parse(body).version,
      true
    );
  }
  @Post('ai/practice/:id/reveal') @HttpCode(200) reveal(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.practice.reveal(
      r.userId,
      id,
      exerciseVersionSchema.parse(body).version
    );
  }
  @Post('ai/practice/:id/answer') @HttpCode(200) answer(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.practice.answer(r.userId, id, exerciseAnswerSchema.parse(body));
  }
  @Get('ai/practice/:id/attempts') attempts(
    @Req() r: UserRequest,
    @Param('id') id: string
  ) {
    return this.practice.attempts(r.userId, id);
  }
}
