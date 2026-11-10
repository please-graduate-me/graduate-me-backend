import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';
import type { Response } from 'express';

/** 내부 오류의 상세 정보가 응답에 노출되지 않게 한다. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (error instanceof ZodError)
      return response.status(400).json({ error: '입력 값을 확인해 주세요.' });

    if (error instanceof HttpException) {
      const body = error.getResponse();

      return response
        .status(error.getStatus())
        .json(
          typeof body === 'object' && 'error' in body
            ? body
            : { error: error.message }
        );
    }

    const parserError = error as { type?: string } | null;

    if (parserError?.type === 'entity.parse.failed')
      return response
        .status(400)
        .json({ error: '올바른 JSON 형식이 아닙니다.' });
    if (parserError?.type === 'entity.too.large')
      return response.status(413).json({ error: '입력 내용이 너무 깁니다.' });

    this.logger.error(
      error instanceof Error ? error.name : '알 수 없는 API 오류'
    );

    return response.status(500).json({
      error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
}
