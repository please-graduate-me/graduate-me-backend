import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { actionSchema } from './actions.js';
import {
  registerVideoSchema,
  videoLikeInputSchema,
  videoFavoriteInputSchema,
} from './contracts.js';
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import { VideosService } from './videos.service.js';

/** 전송 계층의 입력 검증을 업무 처리와 분리한다. */
@Controller('videos')
@UseGuards(AuthGuard)
export class VideosController {
  constructor(@Inject(VideosService) private readonly videos: VideosService) {}
  @Get()
  list(@Req() request: UserRequest) {
    return this.videos.list(request.userId);
  }
  @Post()
  @HttpCode(200)
  register(@Req() request: UserRequest, @Body() body: unknown) {
    const { url, language } = registerVideoSchema.parse(body);

    return this.videos.registerVideo(request.userId, url, language);
  }
  @Get(':id')
  lesson(@Req() request: UserRequest, @Param('id') id: string) {
    return this.videos.getLesson(request.userId, id);
  }
  @Post(':id/retry')
  @HttpCode(200)
  retry(@Req() request: UserRequest, @Param('id') id: string) {
    return this.videos.retryVideo(request.userId, id);
  }
  @Post(':id/actions')
  @HttpCode(200)
  action(
    @Req() request: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.videos.applyAction(
      request.userId,
      id,
      actionSchema.parse(body)
    );
  }
  @Post(':id/like')
  @HttpCode(200)
  like(
    @Req() request: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    const { liked } = videoLikeInputSchema.parse(body);

    return this.videos.setLike(request.userId, id, liked);
  }
  @Post(':id/favorite')
  @HttpCode(200)
  favorite(
    @Req() request: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.videos.setFavorite(
      request.userId,
      id,
      videoFavoriteInputSchema.parse(body).favorite
    );
  }
  @Post(':id/remove')
  @HttpCode(200)
  remove(@Req() request: UserRequest, @Param('id') id: string) {
    return this.videos.removeFromLibrary(request.userId, id);
  }
}
