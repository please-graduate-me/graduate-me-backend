import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { User } from '../database/entities/User.entity.js';
import { HttpError } from '../common/http-error.js';
import { validAdminHash, verifyAdminPassword } from './admin-password.js';

const cookieName = 'graduate-admin-session';

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const lifetime = 8 * 60 * 60 * 1000;

/** 운영 세션은 Google 사용자 세션과 쿠키·저장소·만료를 독립적으로 관리한다. */
@Injectable()
export class AdminAuthService implements OnModuleInit {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  get configured() {
    return Boolean(
      process.env.ADMIN_LOGIN_ID?.trim() &&
      validAdminHash(process.env.ADMIN_PASSWORD_HASH ?? '')
    );
  }
  async onModuleInit() {
    if (!this.configured) return;
    const username = process.env.ADMIN_LOGIN_ID!.trim();

    await this.db.transaction(async (tx) => {
      // 여러 API 인스턴스가 동시에 시작해도 같은 운영 계정을 중복 생성하지 않는다.
      await tx.query(
        `SELECT pg_advisory_xact_lock(hashtext('admin-operator'))`
      );

      const rows: { userId: string }[] = await tx.query(
        `SELECT "userId" FROM "AdminOperator" WHERE username=$1`,
        [username]
      );

      const id = rows[0]?.userId ?? randomUUID();

      if (!rows[0]) await tx.insert(User, { id, name: '운영 관리자' });

      // 배포 비밀 설정만 계정과 비밀번호를 바꾸며 로그인 요청으로는 계정을 만들지 않는다.
      await tx.query(
        `INSERT INTO "AdminOperator"(username,"userId","passwordHash") VALUES($1,$2,$3)
        ON CONFLICT(username) DO UPDATE SET "passwordHash"=EXCLUDED."passwordHash"`,
        [username, id, process.env.ADMIN_PASSWORD_HASH]
      );
    });
  }
  private credentialHash() {
    return digest(
      `${process.env.ADMIN_LOGIN_ID}:${process.env.ADMIN_PASSWORD_HASH}`
    );
  }
  private token(request: Request) {
    const values = (request.headers.cookie ?? '')
      .split(';')
      .map((value) => value.trim());

    return (
      values
        .find((value) => value.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1) ?? ''
    );
  }
  private cookieOptions() {
    return {
      httpOnly: true,
      secure:
        new URL(process.env.ADMIN_URL ?? 'http://localhost:3001').protocol ===
        'https:',
      sameSite: 'strict' as const,
      path: '/api/admin',
    };
  }
  assertOrigin(request: Request) {
    const origin = new URL(process.env.ADMIN_URL ?? 'http://localhost:3001')
      .origin;

    if (request.headers.origin !== origin)
      throw new HttpError(403, '운영 콘솔에서 요청해 주세요.');
  }
  async session(request: Request) {
    if (!this.configured) return null;
    const token = this.token(request);

    if (!/^[a-f0-9]{64}$/.test(token)) return null;

    const rows: { userId: string }[] = await this.db.query(
      `SELECT o."userId" FROM "AdminSession" s JOIN "AdminOperator" o USING(username)
      WHERE s."tokenHash"=$1 AND s."expiresAt">now() AND s."credentialHash"=$2 AND s.username=$3 AND o."passwordHash"=$4`,
      [
        digest(token),
        this.credentialHash(),
        process.env.ADMIN_LOGIN_ID?.trim(),
        process.env.ADMIN_PASSWORD_HASH,
      ]
    );

    return rows[0]?.userId ?? null;
  }
  async login(
    request: Request,
    response: Response,
    username: string,
    password: string
  ) {
    this.assertOrigin(request);
    if (!this.configured)
      throw new HttpError(503, '운영자 인증 설정이 필요합니다.');

    // 여러 API 인스턴스에서도 비밀번호 연산 전에 같은 시도 제한을 적용한다.
    const attempts: { attempts: number }[] = await this.db.query(
      `INSERT INTO "AdminLoginAttempt"(key,attempts) VALUES('console',1)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN "AdminLoginAttempt"."startedAt"<now()-interval '15 minutes' THEN 1 ELSE "AdminLoginAttempt".attempts+1 END,
      "startedAt"=CASE WHEN "AdminLoginAttempt"."startedAt"<now()-interval '15 minutes' THEN now() ELSE "AdminLoginAttempt"."startedAt" END RETURNING attempts`
    );

    if (attempts[0].attempts > 10)
      throw new HttpError(
        429,
        '로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.'
      );

    const operators: { userId: string; passwordHash: string }[] =
      await this.db.query(
        `SELECT "userId","passwordHash" FROM "AdminOperator" WHERE username=$1 AND "passwordHash"=$2`,
        [process.env.ADMIN_LOGIN_ID?.trim(), process.env.ADMIN_PASSWORD_HASH]
      );

    const operator = operators[0];

    if (!operator)
      throw new HttpError(503, '배포 시 운영 계정을 먼저 시딩해 주세요.');
    const matches = await verifyAdminPassword(password, operator.passwordHash);

    if (!matches || username !== process.env.ADMIN_LOGIN_ID?.trim())
      throw new HttpError(401, '아이디 또는 비밀번호를 확인해 주세요.');
    const token = randomBytes(32).toString('hex');

    await this.db.transaction(async (tx) => {
      await tx.query(
        `DELETE FROM "AdminSession" WHERE "expiresAt"<=now() OR "tokenHash"=$1`,
        [digest(this.token(request))]
      );

      await tx.query(
        `INSERT INTO "AdminSession"("tokenHash",username,"credentialHash","expiresAt") VALUES($1,$2,$3,$4)`,
        [
          digest(token),
          username,
          this.credentialHash(),
          new Date(Date.now() + lifetime),
        ]
      );
    });

    response.cookie(cookieName, token, {
      ...this.cookieOptions(),
      maxAge: lifetime,
    });

    return { ok: true, userId: operator.userId };
  }
  async logout(request: Request, response: Response) {
    this.assertOrigin(request);

    await this.db.query(`DELETE FROM "AdminSession" WHERE "tokenHash"=$1`, [
      digest(this.token(request)),
    ]);

    response.clearCookie(cookieName, this.cookieOptions());

    return { ok: true };
  }
}
