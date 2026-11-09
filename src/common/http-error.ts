import { HttpException } from '@nestjs/common';

/** 업무 실패를 일반 서버 오류와 구분해 응답 상태를 유지한다. */
export class HttpError extends HttpException {
  constructor(status: number, message: string) {
    super({ error: message }, status);
    this.message = message;
  }
}
