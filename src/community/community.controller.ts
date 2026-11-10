import {
  Body,
  Controller,
  Delete,
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
import { CommunityService } from './community.service.js';
import {
  communityCommentSchema,
  communityPostSchema,
  communityQuerySchema,
  communityReactionSchema,
} from './contracts.js';

@Controller('community')
@UseGuards(AuthGuard)
/** 로그인한 계정과 글의 공개 범위로 일반 커뮤니티 접근을 제한한다. */
export class CommunityController {
  constructor(
    @Inject(CommunityService) private readonly community: CommunityService
  ) {}
  @Get('posts') list(@Req() r: UserRequest, @Query() q: unknown) {
    return this.community.list(r.userId, communityQuerySchema.parse(q));
  }
  @Post('posts') @HttpCode(200) create(
    @Req() r: UserRequest,
    @Body() b: unknown
  ) {
    return this.community.create(r.userId, communityPostSchema.parse(b));
  }
  @Get('posts/:id') get(@Req() r: UserRequest, @Param('id') id: string) {
    return this.community.get(r.userId, id);
  }
  @Patch('posts/:id') update(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() b: unknown
  ) {
    return this.community.create(r.userId, communityPostSchema.parse(b), id);
  }
  @Delete('posts/:id') remove(@Req() r: UserRequest, @Param('id') id: string) {
    return this.community.remove(r.userId, id);
  }
  @Post('posts/:id/comments') @HttpCode(200) comment(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() b: unknown
  ) {
    return this.community.comment(
      r.userId,
      id,
      communityCommentSchema.parse(b).body
    );
  }
  @Delete('posts/:id/comments/:commentId') removeComment(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Param('commentId') commentId: string
  ) {
    return this.community.removeComment(r.userId, id, commentId);
  }
  @Post('posts/:id/reaction') @HttpCode(200) reaction(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() b: unknown
  ) {
    return this.community.react(
      r.userId,
      id,
      communityReactionSchema.parse(b).active
    );
  }
  @Post('follows/:id') @HttpCode(200) follow(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() b: unknown
  ) {
    return this.community.follow(
      r.userId,
      id,
      communityReactionSchema.parse(b).active
    );
  }
}
