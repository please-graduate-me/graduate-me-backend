import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { awardLearningReward, learningRewardReceipt } from './rewards.js';
import { growthCalendar } from './policy.js';
import { GrowthService } from './growth.service.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('보상 원장의 동시 지급과 선택 공개', () => {
  const db = new DataSource(databaseOptions(testUrl));
  const growth = new GrowthService(db);

  const owner = randomUUID(),
    other = randomUUID(),
    hidden = randomUUID();

  const ids = [owner, other, hidden];

  beforeAll(async () => {
    await db.initialize();

    await db.manager.insert(
      User,
      ids.map((id) => ({
        id,
        name: '공개하면 안 되는 실명',
        email: `${id}@example.test`,
      }))
    );
  });

  beforeEach(async () => {
    await db.query(
      'DELETE FROM "LearningReward" WHERE "ownerId"=ANY($1::text[])',
      [ids]
    );

    await db.query(
      'DELETE FROM "GrowthProfile" WHERE "ownerId"=ANY($1::text[])',
      [ids]
    );
  });

  afterAll(async () => {
    if (!db.isInitialized) return;
    for (const id of ids) await db.manager.delete(User, { id });
    await db.destroy();
  });

  const award = (target: string, assisted = false, account = owner) =>
    db.transaction((tx) =>
      awardLearningReward(tx, account, 'video', target, randomUUID(), assisted)
    );

  it('같은 구절의 동시 정답은 한 번 지급하고 계정은 분리한다', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => award('same'))
    );

    expect(results.filter(Boolean)).toHaveLength(1);

    expect(await growth.summary(owner)).toMatchObject({
      totalXp: 10,
      dailyCompleted: 1,
      participating: false,
      nickname: '',
    });

    expect(await award('same', false, other)).toMatchObject({ xp: 10 });
  });

  it('서로 다른 동시 학습도 일일 한도와 목표 보너스를 각각 한 번 적용한다', async () => {
    await Promise.all(
      Array.from({ length: 15 }, (_, i) => award(`target:${i}`))
    );

    expect(await growth.summary(owner)).toMatchObject({
      totalXp: 120,
      todayXp: 100,
      dailyCompleted: 10,
      dailyGoalReached: true,
      streak: 1,
      level: 2,
      levelXp: 20,
    });

    expect(await award('one-more')).toBeNull();
  });

  it('도움 사용 보상과 재전송 영수증을 보존하고 다른 계정에는 숨긴다', async () => {
    const attempt = randomUUID();

    const reward = await db.transaction((tx) =>
      awardLearningReward(tx, owner, 'exercise', 'exercise', attempt, true)
    );

    expect(reward).toMatchObject({ xp: 5 });

    expect(await learningRewardReceipt(db.manager, owner, attempt)).toEqual(
      reward
    );

    expect(await learningRewardReceipt(db.manager, other, attempt)).toBeNull();

    expect(
      await db.transaction((tx) =>
        awardLearningReward(tx, owner, 'exercise', 'exercise', randomUUID())
      )
    ).toBeNull();
  });

  it('오늘 저장한 표현은 제외하고 전날 표현도 하루 한 번만 보상한다', async () => {
    const practice = (savedAt: Date) =>
      db.transaction((tx) =>
        awardLearningReward(
          tx,
          owner,
          'review',
          'expression',
          randomUUID(),
          false,
          savedAt
        )
      );

    expect(await practice(new Date())).toBeNull();

    expect(await practice(new Date(Date.now() - 86400000))).toMatchObject({
      xp: 5,
    });

    expect(await practice(new Date(Date.now() - 86400000))).toBeNull();
  });

  it('학습 저장이 롤백되면 보상도 함께 취소된다', async () => {
    await expect(
      db.transaction(async (tx) => {
        await awardLearningReward(tx, owner, 'video', 'rollback', randomUUID());
        throw new Error('학습 저장 실패');
      })
    ).rejects.toThrow('학습 저장 실패');

    expect(await growth.summary(owner)).toMatchObject({ totalXp: 0 });
  });

  it('랭킹은 선택 공개 닉네임만 노출하고 동점을 공동 순위로 집계한다', async () => {
    await award('one');
    await award('one', false, other);
    await award('one', false, hidden);
    await growth.preferences(owner, '성장하는부', true);
    await growth.preferences(other, '공부하는부', true);
    await growth.preferences(hidden, '숨긴별명', false);
    const result = await growth.leaderboard(owner);
    const mine = result.items.find((r: { isMe: boolean }) => r.isMe);

    expect(mine).toMatchObject({ nickname: '성장하는부', rank: 1, xp: 10 });

    expect(
      result.items.filter((r: { rank: number }) => r.rank === 1)
    ).toHaveLength(2);

    expect(JSON.stringify(result)).not.toContain('숨긴별명');
    expect(JSON.stringify(result)).not.toContain('@example.test');
    expect(JSON.stringify(result)).not.toContain(owner);
    await growth.preferences(owner, '성장하는부', false);

    expect(
      (await growth.leaderboard(owner)).items.some(
        (r: { isMe: boolean }) => r.isMe
      )
    ).toBe(false);

    expect(await growth.summary(owner)).toMatchObject({ totalXp: 10 });
  });

  it('어제까지의 목표 연속 기록은 유지하고 지난주 XP를 주간 합계에서 제외한다', async () => {
    const { day, weekStart } = growthCalendar();
    const yesterday = new Date(`${day}T00:00:00Z`);

    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const beforeWeek = new Date(`${weekStart}T00:00:00Z`);

    beforeWeek.setUTCDate(beforeWeek.getUTCDate() - 1);

    await db.query(
      `INSERT INTO "LearningReward" ("ownerId",kind,target,xp,day,"rulesVersion") VALUES
      ($1,'daily','yesterday',20,$2,'growth-v1'),($1,'video','old',10,$3,'growth-v1')`,
      [
        owner,
        yesterday.toISOString().slice(0, 10),
        beforeWeek.toISOString().slice(0, 10),
      ]
    );

    const summary = await growth.summary(owner);

    expect(summary.streak).toBe(1);
    expect(summary.todayXp).toBe(0);

    expect(summary.weeklyXp).toBe(
      yesterday.toISOString().slice(0, 10) >= weekStart ? 20 : 0
    );

    expect(summary.totalXp).toBe(30);
  });
});
