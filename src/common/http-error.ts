import { HttpException } from '@nestjs/common';

/** 업무 실패를 일반 서버 오류와 구분해 응답 상태를 유지한다. */
export class HttpError extends HttpException {
  constructor(status: number, message: string, code?: string) {
    // 번역·안내 문구가 바뀌어도 클라이언트가 오류 종류를 문자열 비교로 오인하지 않게 한다.
    super({ error: message, ...(code ? { code } : {}) }, status);
    this.message = message;
  }
}
