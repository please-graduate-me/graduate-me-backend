import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { Account } from '../database/entities/Account.entity.js';
import { Session } from '../database/entities/Session.entity.js';
import { typeormAdapter } from './typeorm-adapter.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('TypeORM 인증 저장 계약', () => {
  const db = new DataSource(databaseOptions(testUrl));
  const ids: string[] = [];

  beforeAll(async () => {
    await db.initialize();
  });

  afterAll(async () => {
    if (ids.length) await db.manager.delete(User, { id: In(ids) });
    await db.destroy();
  });

  it('기존 텍스트 ID와 DB 세션을 조회하고 만료 시각을 갱신한다', async () => {
    const adapter = typeormAdapter(db);
    const id = `existing-${randomUUID()}`;

    ids.push(id);

    await db.manager.insert(User, {
      id,
      name: '기존 사용자',
      email: `${id}@example.test`,
    });

    const sessionToken = randomUUID();
    const expires = new Date(Date.now() + 3600000);

    await db.manager.insert(Session, { userId: id, sessionToken, expires });
    const stored = await adapter.getSessionAndUser!(sessionToken);

    expect(stored?.user.id).toBe(id);
    expect(stored?.user).not.toHaveProperty('autoReplay');
    const next = new Date(expires.getTime() + 3600000);

    expect(
      await adapter.updateSession!({ sessionToken, expires: next })
    ).toMatchObject({ userId: id, expires: next });

    expect(await adapter.updateSession!({ sessionToken })).toMatchObject({
      userId: id,
      expires: next,
    });

    await adapter.deleteSession!(sessionToken);
    expect(await adapter.getSessionAndUser!(sessionToken)).toBeNull();
  });

  it('OAuth 계정 연결과 사용자 수정 및 연결 해제가 동작한다', async () => {
    const adapter = typeormAdapter(db);
    const email = `${randomUUID()}@example.test`;

    const user = await adapter.createUser!({
      id: randomUUID(),
      name: '새 사용자',
      email,
      emailVerified: null,
      image: null,
    });

    ids.push(user.id);
    const key = { provider: 'google', providerAccountId: randomUUID() };

    await adapter.linkAccount!({
      ...key,
      userId: user.id,
      type: 'oauth',
      access_token: 'test-token',
      token_type: 'bearer',
    });

    expect((await adapter.getUserByAccount!(key))?.id).toBe(user.id);
    expect((await adapter.getUserByEmail!(email))?.id).toBe(user.id);

    expect(
      await adapter.getAccount!(key.providerAccountId, key.provider)
    ).toMatchObject({ userId: user.id, type: 'oauth', token_type: 'bearer' });

    expect(
      await adapter.updateUser!({ id: user.id, name: '변경된 이름' })
    ).toMatchObject({ name: '변경된 이름' });

    await adapter.unlinkAccount!(key);
    expect(await adapter.getUserByAccount!(key)).toBeNull();
    await adapter.linkAccount!({ ...key, userId: user.id, type: 'oauth' });

    await adapter.createSession!({
      userId: user.id,
      sessionToken: randomUUID(),
      expires: new Date(Date.now() + 1000),
    });

    await adapter.deleteUser!(user.id);

    expect(
      await db.manager.count(Account, { where: { userId: user.id } })
    ).toBe(0);

    expect(
      await db.manager.count(Session, { where: { userId: user.id } })
    ).toBe(0);
  });

  it('동시에 소비한 인증 토큰은 한 요청에만 반환한다', async () => {
    const adapter = typeormAdapter(db);

    const key = {
      identifier: `${randomUUID()}@example.test`,
      token: randomUUID(),
    };

    await adapter.createVerificationToken!({
      ...key,
      expires: new Date(Date.now() + 1000),
    });

    const results = await Promise.all([
      adapter.useVerificationToken!(key),
      adapter.useVerificationToken!(key),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
