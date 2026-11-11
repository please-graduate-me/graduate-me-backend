import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminController } from '../admin/admin.controller.js';
import { AdminService } from '../admin/admin.service.js';
import { AdminGuard } from '../admin/admin.guard.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { AdminAuthService } from './admin-auth.service.js';
import { hashAdminPassword } from './admin-password.js';

const url = process.env.TEST_DATABASE_URL;

if (url && !new URL(url).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!url)('운영 세션의 저장·만료·폐기', () => {
  const db = new DataSource(databaseOptions(url));
  const service = new AdminAuthService(db);
  const username = `operator-${randomUUID()}`;
  const password = '테스트에서만 사용하는 충분히 긴 운영자 비밀번호';
  const origin = 'https://admin.example.test';

  let app: INestApplication;

  let token = '',
    userId = '';

  const request = (cookie = '') => ({ headers: { origin, cookie } }) as Request;

  const response = () =>
    ({ cookie: vi.fn(), clearCookie: vi.fn() }) as unknown as Response;

  beforeAll(async () => {
    await db.initialize();
    vi.stubEnv('ADMIN_URL', origin);
    vi.stubEnv('ADMIN_LOGIN_ID', username);
    vi.stubEnv('ADMIN_PASSWORD_HASH', await hashAdminPassword(password));

    class AuthTestModule {}

    app = await NestFactory.create(
      {
        module: AuthTestModule,
        controllers: [AdminAuthController, AdminController],
        providers: [
          AdminAuthService,
          AdminAuthGuard,
          AdminService,
          AdminGuard,
          { provide: DataSource, useValue: db },
        ],
      },
      { logger: false }
    );

    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1');
    await db.query('DELETE FROM "AdminLoginAttempt"');

    const operators = await db.query(
      'SELECT "userId" FROM "AdminOperator" WHERE username=$1',
      [username]
    );

    userId = operators[0].userId;
  });

  afterAll(async () => {
    if (app) await app.close();

    if (db.isInitialized) {
      if (userId) await db.manager.delete(User, { id: userId });
      await db.query('DELETE FROM "AdminLoginAttempt"');
      await db.destroy();
    }

    vi.unstubAllEnvs();
  });

  it('로그인 전에 계정을 시딩하고 반복 초기화로 계정을 중복 생성하지 않는다', async () => {
    const before = await db.query(
      'SELECT "userId","passwordHash" FROM "AdminOperator" WHERE username=$1',
      [username]
    );

    expect(before).toHaveLength(1);
    expect(before[0].passwordHash).toBe(process.env.ADMIN_PASSWORD_HASH);
    expect(before[0].passwordHash).not.toBe(password);
    await service.onModuleInit();

    const after = await db.query(
      'SELECT "userId" FROM "AdminOperator" WHERE username=$1',
      [username]
    );

    expect(after).toEqual([{ userId }]);
  });

  it('시딩 계정이 없으면 올바른 비밀번호로도 로그인이나 자동 가입이 되지 않는다', async () => {
    await db.query('DELETE FROM "AdminOperator" WHERE username=$1', [username]);

    try {
      await expect(
        service.login(request(), response(), username, password)
      ).rejects.toMatchObject({ status: 503 });

      expect(
        await db.query(
          'SELECT username FROM "AdminOperator" WHERE username=$1',
          [username]
        )
      ).toEqual([]);
    } finally {
      // 검증 후 원래 시딩 상태를 복원한다.
      await db.query(
        'INSERT INTO "AdminOperator"(username,"userId","passwordHash") VALUES($1,$2,$3)',
        [username, userId, process.env.ADMIN_PASSWORD_HASH]
      );
    }
  });

  it('올바른 자격 증명만 운영 세션을 만들고 토큰 원문은 DB에 저장하지 않는다', async () => {
    await expect(
      service.login(request(), response(), username, '틀린 비밀번호')
    ).rejects.toMatchObject({ status: 401 });

    const res = response();
    const result = await service.login(request(), res, username, password);

    userId = result.userId;
    token = vi.mocked(res.cookie).mock.calls[0][1];

    expect(res.cookie).toHaveBeenCalledWith(
      'graduate-admin-session',
      expect.any(String),
      expect.objectContaining({
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/admin',
      })
    );

    expect(
      await service.session(request(`graduate-admin-session=${token}`))
    ).toBe(userId);

    expect(
      await service.session(request('authjs.session-token=google-session'))
    ).toBeNull();

    const rows = await db.query(
      'SELECT "tokenHash" FROM "AdminSession" WHERE username=$1',
      [username]
    );

    expect(rows[0].tokenHash).not.toBe(token);
  });

  it('만료와 자격 증명 변경은 기존 세션을 무효화한다', async () => {
    const req = request(`graduate-admin-session=${token}`);

    vi.stubEnv('ADMIN_PASSWORD_HASH', await hashAdminPassword(password));
    expect(await service.session(req)).toBeNull();
    await service.onModuleInit();
    const res = response();

    await service.login(request(), res, username, password);
    token = vi.mocked(res.cookie).mock.calls[0][1];

    await db.query(
      'UPDATE "AdminSession" SET "expiresAt"=now()-interval \'1 second\' WHERE username=$1',
      [username]
    );

    expect(
      await service.session(request(`graduate-admin-session=${token}`))
    ).toBeNull();
  });

  it('학생 출처는 로그인·로그아웃을 요청할 수 없고 로그아웃한 토큰은 재사용할 수 없다', async () => {
    const bad = {
      headers: { origin: 'https://student.example.test' },
    } as Request;

    await expect(
      service.login(bad, response(), username, password)
    ).rejects.toMatchObject({ status: 403 });

    await expect(service.logout(bad, response())).rejects.toMatchObject({
      status: 403,
    });

    const res = response();

    await service.login(request(), res, username, password);
    token = vi.mocked(res.cookie).mock.calls[0][1];
    const req = request(`graduate-admin-session=${token}`);

    await service.logout(req, res);
    expect(await service.session(req)).toBeNull();
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('공유 저장소의 로그인 제한을 넘으면 비밀번호 검증 전에 차단한다', async () => {
    await db.query('UPDATE "AdminLoginAttempt" SET attempts=10');

    await expect(
      service.login(request(), response(), username, password)
    ).rejects.toMatchObject({ status: 429 });
  });

  it('실제 운영 HTTP 경로에서도 Google 쿠키와 잘못된 출처를 거부한다', async () => {
    await db.query('DELETE FROM "AdminLoginAttempt"');
    const base = await app.getUrl();

    const google = await fetch(`${base}/api/admin/access`, {
      headers: { Cookie: 'authjs.session-token=google-user' },
    });

    expect(google.status).toBe(401);

    const bad = await fetch(`${base}/api/admin/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://student.example.test',
      },
      body: JSON.stringify({ username, password }),
    });

    expect(bad.status).toBe(403);

    const login = await fetch(`${base}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ username, password }),
    });

    expect(login.status).toBe(200);

    const unregistered = await fetch(`${base}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ username: 'unregistered-operator', password }),
    });

    expect(unregistered.status).toBe(401);

    const registration = await fetch(`${base}/api/admin/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ username: 'unregistered-operator', password }),
    });

    expect(registration.status).toBe(404);

    expect(
      await db.query('SELECT username FROM "AdminOperator" WHERE username=$1', [
        'unregistered-operator',
      ])
    ).toEqual([]);

    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';

    expect(cookie).toContain('graduate-admin-session=');

    const access = await fetch(`${base}/api/admin/access`, {
      headers: { Cookie: cookie },
    });

    expect(access.status).toBe(200);
    expect(await access.json()).toMatchObject({ allowed: true });
    expect(access.headers.get('cache-control')).toContain('no-store');

    const logout = await fetch(`${base}/api/admin/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin },
    });

    expect(logout.status).toBe(200);

    expect(
      (await fetch(`${base}/api/admin/access`, { headers: { Cookie: cookie } }))
        .status
    ).toBe(401);
  });
});
