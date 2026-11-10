import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Request, RequestHandler, Response } from 'express';

const requestIdKey = Symbol('serverRequestId');
const errorCodeKey = Symbol('serverErrorCode');

const methods = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'CONNECT',
  'TRACE',
]);

type IdentifiedRequest = Request & { [requestIdKey]?: string };
type IdentifiedResponse = Response & { [errorCodeKey]?: string };

/** 고정형 업무 오류 코드만 요청 로그의 내부 채널에 보관한다. */
export function setRequestErrorCode(response: Response, code: unknown) {
  // 잘못 전달된 예외 원문이나 토큰이 코드 필드를 통해 로그에 섞이지 않게 한다.
  if (typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code))
    (response as IdentifiedResponse)[errorCodeKey] = code;
}

/** 외부 요청 헤더와 독립적인 서버 요청 ID를 같은 요청 안에서 재사용한다. */
export function requestIdFor(request: Request) {
  const identified = request as IdentifiedRequest;

  // 클라이언트가 보낸 ID로 다른 요청의 로그를 사칭하지 못하게 한다.
  return (identified[requestIdKey] ??= randomUUID());
}

function routePattern(request: Request, authentication: boolean) {
  if (typeof request.route?.path === 'string') return request.route.path;

  // 인증은 Express 미들웨어에서 끝나므로 실제 URL 대신 고정 업무 이름만 남긴다.
  return authentication ? 'auth' : 'unmatched';
}

/** 요청 내용 없이 완료 상태와 추적 ID만 한 줄 JSON으로 stdout에 기록한다. */
export function createRequestLogger(
  write: (line: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  }
): RequestHandler {
  return (request, response, next) => {
    const requestId = requestIdFor(request);
    const started = performance.now();
    // 마운트된 미들웨어는 request.path를 줄이므로 내용 대신 고정 분류만 미리 보관한다.
    const authentication = /^\/api\/auth(?:\/|$)/.test(request.path);
    const health = request.path === '/api/health';
    let recorded = false;

    response.setHeader('X-Request-Id', requestId);

    const record = (outcome: 'finish' | 'aborted') => {
      // 정상 종료 뒤 close도 발생하므로 요청당 한 번만 기록한다.
      if (recorded) return;
      recorded = true;
      // 정상 헬스체크만 생략하고 준비 실패나 연결 중단은 진단할 수 있게 남긴다.
      if (
        outcome === 'finish' &&
        response.statusCode < 400 &&
        ['GET', 'HEAD'].includes(request.method) &&
        health
      )
        return;

      const errorCode = (response as IdentifiedResponse)[errorCodeKey];

      write(
        JSON.stringify({
          event: 'http_request',
          timestamp: new Date().toISOString(),
          requestId,
          method: methods.has(request.method) ? request.method : 'OTHER',
          route: routePattern(request, authentication),
          status:
            outcome === 'aborted' && !response.headersSent
              ? null
              : response.statusCode,
          durationMs: Math.max(0, Math.round(performance.now() - started)),
          outcome,
          ...(errorCode ? { errorCode } : {}),
        })
      );
    };

    response.once('finish', () => record('finish'));

    response.once('close', () =>
      record(response.writableFinished ? 'finish' : 'aborted')
    );

    next();
  };
}
