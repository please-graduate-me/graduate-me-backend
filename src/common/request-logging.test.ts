import 'reflect-metadata';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, Module } from '@nestjs/common';
import { z } from 'zod';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { HttpError } from './http-error.js';
import { createRequestLogger } from './request-logging.js';

type RecordLine = {
  requestId: string;
  status: number | null;
  route: string;
  outcome: string;
  durationMs: number;
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class HttpLoggingTestModule {}

Module({})(HttpLoggingTestModule);

describe('민감정보 없는 HTTP 요청 추적', () => {
  const logs: string[] = [];
  let server: Server;
  let fixture: NestExpressApplication;
  let base: string;
  let slowStarted: (() => void) | undefined;
  let aborted: ((line: RecordLine) => void) | undefined;

  const send = (
    path: string,
    method = 'GET',
    body?: string,
    headers: Record<string, string> = {}
  ) =>
    new Promise<{
      status: number;
      requestId: string;
      body: Record<string, unknown>;
    }>((resolve, reject) => {
      const request = httpRequest(
        new URL(path, base),
        { method, headers },
        (response) => {
          let data = '';

          response.setEncoding('utf8');

          response.on('data', (chunk) => {
            data += chunk;
          });

          response.on('end', () =>
            resolve({
              status: response.statusCode!,
              requestId: String(response.headers['x-request-id']),
              body: JSON.parse(data),
            })
          );
        }
      );

      request.on('error', reject);
      request.end(body);
    });

  beforeAll(async () => {
    // 실제 앱 모듈을 가져오지 않아 DB·공급자·worker를 시작하지 않는다.
    fixture = await NestFactory.create<NestExpressApplication>(
      HttpLoggingTestModule,
      { bodyParser: false, logger: false }
    );

    fixture.useGlobalFilters(new ApiExceptionFilter());
    const app = fixture.getHttpAdapter().getInstance() as express.Express;

    app.use(
      createRequestLogger((line) => {
        logs.push(line);
        const parsed = JSON.parse(line) as RecordLine;

        if (parsed.outcome === 'aborted') aborted?.(parsed);
      })
    );

    app.use(express.json({ limit: '128b' }));

    app.post('/api/resources/:userId', (_request, response) =>
      response.status(201).json({ ok: true })
    );

    app.get('/api/errors/:kind', (request) => {
      if (request.params.kind === 'zod')
        z.object({ value: z.string() }).parse({ value: 1 });
      if (request.params.kind === 'http')
        throw new BadRequestException('입력 오류');
      if (request.params.kind === 'coded')
        throw new HttpError(
          422,
          '생성 결과를 확인해 주세요.',
          'AI_RESULT_REJECTED'
        );
      if (request.params.kind === 'unsafe-code')
        throw new HttpError(422, '생성 결과를 확인해 주세요.', 'token-secret');
      throw new Error('본문·토큰·키가 섞인 내부 오류 secret-stack');
    });

    app.get('/api/slow/:id', () => slowStarted?.());

    app.get('/api/health', (request, response) => {
      if (request.query.fail) throw new HttpError(503, '준비 실패');
      response.json({ status: 'ok' });
    });

    app.use('/api/auth', (_request, response) =>
      response.status(401).json({ error: '로그인이 필요합니다.' })
    );

    await fixture.listen(0, '127.0.0.1');
    server = fixture.getHttpServer() as Server;

    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();

    await fixture.close();
  });

  it('클라이언트 ID를 신뢰하지 않고 완료 요청을 패턴·상태·시간으로 한 번만 기록한다', async () => {
    const before = logs.length;
    const externalId = '00000000-0000-4000-8000-000000000000';

    const response = await send(
      '/api/resources/user-secret?email=mail-secret',
      'POST',
      '{"value":"body-secret"}',
      {
        'content-type': 'application/json',
        'x-request-id': externalId,
        authorization: 'Bearer token-secret',
        cookie: 'session=cookie-secret',
        'x-forwarded-for': '192.0.2.75',
      }
    );

    expect(response.status).toBe(201);
    expect(response.requestId).toMatch(uuid);
    expect(response.requestId).not.toBe(externalId);
    const lines = logs.slice(before);

    expect(lines).toHaveLength(1);
    const log = JSON.parse(lines[0]);

    expect(log).toEqual({
      event: 'http_request',
      timestamp: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      ),
      requestId: response.requestId,
      method: 'POST',
      route: '/api/resources/:userId',
      status: 201,
      durationMs: expect.any(Number),
      outcome: 'finish',
    });

    expect(log.durationMs).toBeGreaterThanOrEqual(0);

    expect(lines[0]).not.toMatch(
      /user-secret|mail-secret|body-secret|token-secret|cookie-secret|192\.0\.2\.75|authorization|cookie|stack|\n/
    );
  });

  it('Nest·Zod·오류 코드·내부 500의 JSON과 로그에 같은 요청 ID를 연결한다', async () => {
    for (const [kind, status] of [
      ['http', 400],
      ['zod', 400],
      ['coded', 422],
      ['internal', 500],
      ['unsafe-code', 422],
    ] as const) {
      const response = await send(`/api/errors/${kind}`);

      expect(response.status).toBe(status);
      expect(response.body.requestId).toBe(response.requestId);
      expect(response.requestId).toMatch(uuid);

      expect(JSON.parse(logs.at(-1)!)).toMatchObject({
        requestId: response.requestId,
        route: '/api/errors/:kind',
        status,
        outcome: 'finish',
      });

      if (kind === 'coded') {
        expect(response.body.code).toBe('AI_RESULT_REJECTED');
        expect(JSON.parse(logs.at(-1)!).errorCode).toBe('AI_RESULT_REJECTED');
      } else expect(JSON.parse(logs.at(-1)!)).not.toHaveProperty('errorCode');
      expect(JSON.stringify(response.body)).not.toContain('secret-stack');
    }

    expect(logs.join('')).not.toMatch(/secret-stack|token-secret/);
  });

  it('라우팅 전에 실패한 JSON 파싱과 본문 상한도 같은 오류 ID로 조회할 수 있다', async () => {
    const invalid = await send(
      '/api/resources/user-secret?token=query-secret',
      'POST',
      '{',
      { 'content-type': 'application/json' }
    );

    const large = await send(
      '/api/resources/user-secret',
      'POST',
      JSON.stringify({ value: 'x'.repeat(200) }),
      { 'content-type': 'application/json' }
    );

    expect(invalid.status).toBe(400);
    expect(large.status).toBe(413);
    for (const response of [invalid, large])
      expect(response.body.requestId).toBe(response.requestId);
    expect(logs.join('')).not.toMatch(/user-secret|query-secret/);
  });

  it('인증 미들웨어와 없는 경로는 실제 URL을 남기지 않는 고정 이름으로 기록한다', async () => {
    const auth = await send('/api/auth/private-secret?token=auth-secret');

    expect(auth.status).toBe(401);

    expect(JSON.parse(logs.at(-1)!)).toMatchObject({
      requestId: auth.requestId,
      route: 'auth',
      status: 401,
    });

    const missing = await send('/api/unknown/private-secret');

    expect(missing.status).toBe(404);
    expect(missing.body.requestId).toBe(missing.requestId);

    expect(JSON.parse(logs.at(-1)!)).toMatchObject({
      route: 'unmatched',
      status: 404,
    });

    expect(logs.join('')).not.toMatch(/private-secret|auth-secret/);
  });

  it('정상 헬스체크는 생략하고 실패한 헬스체크는 기록한다', async () => {
    const before = logs.length;

    await send('/api/health');
    expect(logs).toHaveLength(before);
    const failed = await send('/api/health?fail=true');

    expect(failed.status).toBe(503);

    expect(JSON.parse(logs.at(-1)!)).toMatchObject({
      route: '/api/health',
      status: 503,
    });
  });

  it('응답 전 연결 중단을 성공 응답과 구분하며 한 번만 기록한다', async () => {
    const started = new Promise<void>((resolve) => {
      slowStarted = resolve;
    });

    const log = new Promise<RecordLine>((resolve) => {
      aborted = resolve;
    });

    const request = httpRequest(new URL('/api/slow/private-secret', base));

    request.on('error', () => {});
    request.end();
    await started;
    request.destroy();

    expect(await log).toMatchObject({
      route: '/api/slow/:id',
      status: null,
      outcome: 'aborted',
      requestId: expect.stringMatching(uuid),
    });

    expect(
      logs
        .map((line) => JSON.parse(line))
        .filter((line) => line.outcome === 'aborted')
    ).toHaveLength(1);

    slowStarted = undefined;
    aborted = undefined;
  });
});
