import type { Adapter, AdapterUser, AdapterAccount } from '@auth/core/adapters';
import type { DataSource } from 'typeorm';
import { User } from '../database/entities/User.entity.js';
import { Account } from '../database/entities/Account.entity.js';
import { Session } from '../database/entities/Session.entity.js';
import { VerificationToken } from '../database/entities/VerificationToken.entity.js';

function authUser(user: User): AdapterUser {
  // DB의 학습 옵션과 관계 정보가 인증 응답에 섞이지 않게 한다.
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? '',
    emailVerified: user.emailVerified,
    image: user.image,
  };
}

/** 기존 계정과 세션 테이블을 유지하면서 Auth.js의 저장 계약을 TypeORM으로 구현한다. */
export function typeormAdapter(db: DataSource): Adapter {
  const users = db.getRepository(User);
  const accounts = db.getRepository(Account);
  const sessions = db.getRepository(Session);

  return {
    async createUser(data) {
      const inserted = await users.insert(data);

      return authUser(
        await users.findOneByOrFail({
          id: inserted.identifiers[0].id as string,
        })
      );
    },
    async getUser(id) {
      const user = await users.findOneBy({ id });

      return user ? authUser(user) : null;
    },
    async getUserByEmail(email) {
      const user = await users.findOneBy({ email });

      return user ? authUser(user) : null;
    },
    async getUserByAccount(key) {
      const account = await accounts.findOne({
        where: key,
        relations: { user: true },
      });

      return account ? authUser(account.user) : null;
    },
    async updateUser({ id, ...data }) {
      if (Object.values(data).some((value) => value !== undefined))
        await users.update({ id }, data);

      return authUser(await users.findOneByOrFail({ id }));
    },
    async deleteUser(id) {
      await users.delete({ id });
    },
    async linkAccount(data) {
      await accounts.insert({
        userId: data.userId,
        type: data.type,
        provider: data.provider,
        providerAccountId: data.providerAccountId,
        refresh_token: data.refresh_token,
        access_token: data.access_token,
        expires_at: data.expires_at,
        token_type: data.token_type,
        scope: data.scope,
        id_token: data.id_token,
        session_state:
          typeof data.session_state === 'string' ? data.session_state : null,
      });
    },
    async unlinkAccount(key) {
      await accounts.delete(key);
    },
    async getAccount(providerAccountId, provider) {
      const account = await accounts.findOneBy({ providerAccountId, provider });

      if (!account) return null;

      return {
        userId: account.userId,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        type: account.type as AdapterAccount['type'],
        refresh_token: account.refresh_token ?? undefined,
        access_token: account.access_token ?? undefined,
        expires_at: account.expires_at ?? undefined,
        token_type: account.token_type?.toLowerCase() as
          Lowercase<string> | undefined,
        scope: account.scope ?? undefined,
        id_token: account.id_token ?? undefined,
        session_state: account.session_state ?? undefined,
      };
    },
    async createSession(data) {
      await sessions.insert(data);

      return data;
    },
    async getSessionAndUser(sessionToken) {
      const session = await sessions.findOne({
        where: { sessionToken },
        relations: { user: true },
      });

      if (!session) return null;

      return {
        session: {
          sessionToken: session.sessionToken,
          userId: session.userId,
          expires: session.expires,
        },
        user: authUser(session.user),
      };
    },
    async updateSession({ sessionToken, ...data }) {
      if (Object.values(data).some((value) => value !== undefined))
        await sessions.update({ sessionToken }, data);
      const session = await sessions.findOneBy({ sessionToken });

      if (!session) return null;

      return { sessionToken, userId: session.userId, expires: session.expires };
    },
    async deleteSession(sessionToken) {
      await sessions.delete({ sessionToken });
    },
    async createVerificationToken(data) {
      await db.manager.insert(VerificationToken, data);

      return data;
    },
    async useVerificationToken(key) {
      // 토큰 소비와 삭제를 한 쿼리로 처리해 동시에 두 번 사용되지 않게 한다.
      const result = await db
        .createQueryBuilder()
        .delete()
        .from(VerificationToken)
        .where(key)
        .returning('*')
        .execute();

      return (result.raw as VerificationToken[])[0] ?? null;
    },
  };
}
