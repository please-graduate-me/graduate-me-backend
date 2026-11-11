import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { HelperProfile } from '../database/entities/HelperProfile.entity.js';
import { ProfileService } from '../users/profile.service.js';
import { SourceService } from '../learning/source.service.js';
import { CommunityService } from './community.service.js';
import { communityPostSchema, communityQuerySchema } from './contracts.js';

const url = process.env.TEST_DATABASE_URL;

if (url && !new URL(url).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!url)('조교 프로필과 커뮤니티 태그', () => {
  const db = new DataSource(databaseOptions(url));
  const service = new CommunityService(db, new SourceService(db));

  const owner = randomUUID(),
    helper = randomUUID(),
    other = randomUUID();

  const input = (patch = {}) =>
    communityPostSchema.parse({
      title: '조교와 함께 보는 질문',
      body: '이 표현은 어떤 의미인가요?',
      language: 'en',
      visibility: 'public',
      taggedHelperIds: [helper],
      ...patch,
    });

  beforeAll(async () => {
    await db.initialize();

    await db.manager.insert(User, [
      { id: owner },
      { id: helper, name: '조교' },
      { id: other },
    ]);

    await db.manager.insert(HelperProfile, {
      userId: helper,
      languages: [],
      materialIds: [],
      active: true,
    });
  });

  afterAll(async () => {
    if (db.isInitialized) {
      await db.manager.delete(User, { id: In([owner, helper, other]) });
      await db.destroy();
    }
  });

  it('조교 타이틀과 댓글은 모든 열람 가능한 사용자에게 표시된다', async () => {
    expect((await new ProfileService(db).get(helper)).isHelper).toBe(true);
    const post = await service.create(owner, input());

    await service.comment(helper, post.id, '댓글로 함께 답변합니다.');
    const detail = await service.get(other, post.id);

    expect(detail.taggedHelpers.map((h) => h.id)).toEqual([helper]);
    expect(detail.comments[0].author.isHelper).toBe(true);

    expect((await service.get(helper, post.id)).comments[0].body).toBe(
      '댓글로 함께 답변합니다.'
    );

    expect(
      (
        await service.list(
          helper,
          communityQuerySchema.parse({ tagged: 'true' })
        )
      ).items.some((p) => p.id === post.id)
    ).toBe(true);

    await service.create(owner, input({ taggedHelperIds: [] }), post.id);

    expect(
      (
        await service.list(
          helper,
          communityQuerySchema.parse({ tagged: 'true' })
        )
      ).items.some((p) => p.id === post.id)
    ).toBe(false);
  });

  it('일반 사용자 태그와 비공개 글의 암묵적 공개를 거부한다', async () => {
    await expect(
      service.create(owner, input({ taggedHelperIds: [other] }))
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      service.create(
        owner,
        input({ visibility: 'accounts', allowedUserIds: [other] })
      )
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      service.list(other, communityQuerySchema.parse({ tagged: 'true' }))
    ).rejects.toMatchObject({ status: 403 });

    const post = await service.create(
      owner,
      input({ visibility: 'accounts', allowedUserIds: [helper] })
    );

    await expect(service.get(other, post.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('조교 자격을 회수하면 배지와 태그 모아보기 권한도 회수한다', async () => {
    await db.manager.update(
      HelperProfile,
      { userId: helper },
      { active: false }
    );

    expect((await new ProfileService(db).get(helper)).isHelper).toBe(false);

    await expect(
      service.list(helper, communityQuerySchema.parse({ tagged: 'true' }))
    ).rejects.toMatchObject({ status: 403 });

    await expect(service.create(owner, input())).rejects.toMatchObject({
      status: 400,
    });
  });
});
