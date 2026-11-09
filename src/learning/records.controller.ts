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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import {
  RecordsService,
  annotationInputSchema,
  annotationUpdateSchema,
  annotationsQuerySchema,
  excerptShareInputSchema,
} from './records.service.js';

@Controller()
@UseGuards(AuthGuard)
/** 인증한 본인의 개인 주석과 명시적인 발췌 공유만 처리한다. */
export class RecordsController {
  constructor(
    @Inject(RecordsService) private readonly records: RecordsService
  ) {}
  @Get('annotations')
  @Header('Cache-Control', 'private, no-store')
  annotations(@Req() request: UserRequest, @Query() query: unknown) {
    return this.records.annotations(
      request.userId,
      annotationsQuerySchema.parse(query)
    );
  }
  @Post('annotations')
  @HttpCode(200)
  annotate(@Req() request: UserRequest, @Body() body: unknown) {
    return this.records.annotate(
      request.userId,
      annotationInputSchema.parse(body)
    );
  }
  @Patch('annotations/:id')
  updateAnnotation(
    @Req() request: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.records.updateAnnotation(
      request.userId,
      id,
      annotationUpdateSchema.parse(body)
    );
  }
  @Delete('annotations/:id')
  removeAnnotation(@Req() request: UserRequest, @Param('id') id: string) {
    return this.records.removeAnnotation(request.userId, id);
  }
  @Get('excerpt-shares')
  @Header('Cache-Control', 'private, no-store')
  shares(@Req() request: UserRequest) {
    return this.records.shares(request.userId);
  }
  @Post('excerpt-shares')
  @HttpCode(200)
  share(@Req() request: UserRequest, @Body() body: unknown) {
    return this.records.share(
      request.userId,
      excerptShareInputSchema.parse(body)
    );
  }
  @Get('excerpt-shares/:id')
  @Header('Cache-Control', 'private, no-store')
  shared(@Req() request: UserRequest, @Param('id') id: string) {
    return this.records.shared(request.userId, id);
  }
  @Post('excerpt-shares/:id/revoke')
  @HttpCode(200)
  revoke(@Req() request: UserRequest, @Param('id') id: string) {
    return this.records.revoke(request.userId, id);
  }
}
