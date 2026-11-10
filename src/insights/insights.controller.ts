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
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import {
  recommendationEventSchema,
  insightQuerySchema,
  recommendationFeedbackSchema,
} from './contracts.js';
import { InsightsService } from './insights.service.js';

/** 개인 분석은 세션 계정의 기록만 사용하고 조회 중 외부 AI를 호출하지 않는다. */
@Controller()
@UseGuards(AuthGuard)
export class InsightsController {
  constructor(
    @Inject(InsightsService) private readonly insights: InsightsService
  ) {}
  @Get('learning/insights')
  report(@Req() r: UserRequest, @Query() query: unknown) {
    const input = insightQuerySchema.parse(query);

    return this.insights.report(r.userId, input.language, input.days);
  }
  @Get('recommendations')
  recommendations(@Req() r: UserRequest, @Query() query: unknown) {
    return this.insights.recommendations(
      r.userId,
      insightQuerySchema.parse(query).language
    );
  }
  @Post('recommendations/:id/events')
  @HttpCode(200)
  event(@Req() r: UserRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = recommendationEventSchema.parse(body);

    return this.insights.event(r.userId, id, input.requestId, input.action);
  }
  @Post('recommendations/:id/feedback')
  @HttpCode(200)
  feedback(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.insights.feedback(
      r.userId,
      id,
      recommendationFeedbackSchema.parse(body).interested
    );
  }
}
