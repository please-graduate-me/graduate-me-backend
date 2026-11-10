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
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type UserRequest } from '../auth/auth.guard.js';
import { CoursesService } from './courses.service.js';
import {
  assignmentHintSchema,
  assignmentInputSchema,
  assignmentSubmitSchema,
  assignmentUpdateSchema,
  courseInputSchema,
  courseJoinSchema,
  courseMemberSchema,
} from './contracts.js';

/** 수업 역할은 전역 도우미·관리자 권한과 독립적으로 검사한다. */
@Controller('courses')
@UseGuards(AuthGuard)
export class CoursesController {
  constructor(
    @Inject(CoursesService) private readonly courses: CoursesService
  ) {}
  @Get() list(@Req() r: UserRequest) {
    return this.courses.list(r.userId);
  }
  @Post() @HttpCode(200) create(@Req() r: UserRequest, @Body() body: unknown) {
    return this.courses.create(r.userId, courseInputSchema.parse(body));
  }
  @Post('join') @HttpCode(200) join(
    @Req() r: UserRequest,
    @Body() body: unknown
  ) {
    return this.courses.join(r.userId, courseJoinSchema.parse(body).inviteCode);
  }
  @Get(':id') detail(@Req() r: UserRequest, @Param('id') id: string) {
    return this.courses.detail(r.userId, id);
  }
  @Post(':id/members') @HttpCode(200) member(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.courses.member(r.userId, id, courseMemberSchema.parse(body));
  }
  @Delete(':id/members/:userId') removeMember(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Param('userId') userId: string
  ) {
    return this.courses.removeMember(r.userId, id, userId);
  }
  @Post(':id/assignments') @HttpCode(200) assign(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Body() body: unknown
  ) {
    return this.courses.assign(r.userId, id, assignmentInputSchema.parse(body));
  }
  @Get(':id/assignments/:assignmentId') assignment(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string
  ) {
    return this.courses.getAssignment(r.userId, id, assignmentId);
  }
  @Patch(':id/assignments/:assignmentId') update(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown
  ) {
    const input = assignmentUpdateSchema.parse(body);

    return this.courses.assign(r.userId, id, input, assignmentId, input);
  }
  @Post(':id/assignments/:assignmentId/hints')
  @HttpCode(200)
  hint(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown
  ) {
    const input = assignmentHintSchema.parse(body);

    return this.courses.hint(
      r.userId,
      id,
      assignmentId,
      input.version,
      input.taskId
    );
  }
  @Post(':id/assignments/:assignmentId/submissions') @HttpCode(200) submit(
    @Req() r: UserRequest,
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown
  ) {
    return this.courses.submit(
      r.userId,
      id,
      assignmentId,
      assignmentSubmitSchema.parse(body)
    );
  }
}
