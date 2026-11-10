import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { ZodError } from 'zod';
import type { Request, Response } from 'express';
import { requestIdFor, setRequestErrorCode } from './request-logging.js';

/** 내부 오류의 상세 정보가 응답에 노출되지 않게 한다. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const requestId = requestIdFor(context.getRequest<Request>());

    response.setHeader('X-Request-Id', requestId);

    if (error instanceof ZodError)
      return response
        .status(400)
        .json({ error: '입력 값을 확인해 주세요.', requestId });

    if (error instanceof HttpException) {
      const body = error.getResponse();

      if (body && typeof body === 'object' && 'code' in body)
        setRequestErrorCode(response, body.code);

      return response
        .status(error.getStatus())
        .json(
          body && typeof body === 'object' && 'error' in body
            ? { ...body, requestId }
            : { error: error.message, requestId }
        );
    }

    const parserError = error as { type?: string } | null;

    if (parserError?.type === 'entity.parse.failed')
      return response
        .status(400)
        .json({ error: '올바른 JSON 형식이 아닙니다.', requestId });
    if (parserError?.type === 'entity.too.large')
      return response
        .status(413)
        .json({ error: '입력 내용이 너무 깁니다.', requestId });

    // 예외 이름·메시지·스택에는 공급자 응답이나 개인 원문이 섞일 수 있어 기록하지 않는다.
    return response.status(500).json({
      error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      requestId,
    });
  }
}
