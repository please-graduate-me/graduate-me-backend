import type { Request, RequestHandler } from 'express';
import { appOrigins } from './origins.js';

function singleHost(value: string | string[] | undefined) {
  return typeof value === 'string' && !/[\s,/@?#\\]/u.test(value)
    ? value.toLowerCase()
    : null;
}

/** 프록시가 전달한 호스트도 설정된 학생·관리자 출처에 정확히 일치할 때만 인증 주소로 사용한다. */
export function authRequestOrigin(request: Pick<Request, 'headers'>) {
  const origins = appOrigins().map((origin) => new URL(origin));

  const hosts = [
    singleHost(request.headers['x-forwarded-host']),
    singleHost(request.headers.host),
  ];

  // 프로토콜은 외부 헤더가 아니라 허용 목록의 설정값을 사용해 HTTPS 쿠키가 약화되지 않게 한다.
  for (const host of hosts) {
    const match =
      host && origins.find((origin) => origin.host.toLowerCase() === host);

    if (match) return match;
  }

  // 학생 앱의 서버 내부 조회는 api 같은 Compose 호스트로 들어오므로 학생의 공개 출처를 사용한다.
  return origins[0];
}

/** 인증 요청의 URL·콜백·쿠키가 허용한 실제 앱 출처에서 함께 결정되도록 고정한다. */
export const normalizeAuthOrigin: RequestHandler = (
  request,
  _response,
  next
) => {
  const origin = authRequestOrigin(request);

  request.headers.host = origin.host;
  request.headers['x-forwarded-host'] = origin.host;
  request.headers['x-forwarded-proto'] = origin.protocol.slice(0, -1);
  next();
};
