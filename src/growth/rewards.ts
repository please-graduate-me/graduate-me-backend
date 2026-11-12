import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { LearningSource } from '../learning/contracts.js';
import { growthCalendar, growthLevel, growthPolicy } from './policy.js';

/** 삭제·재저장과 원문 버전 변경으로 같은 표현의 보상을 우회하지 못하게 한다. */
export function reviewRewardTarget(source: LearningSource, text: string) {
  const location =
    source.kind === 'pdf'
      ? ['pdf', source.materialId, source.page]
      : ['video', source.videoId, source.segmentId];

  return createHash('sha256')
    .update(
      JSON.stringify([
        ...location,
        text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(),
      ])
    )
    .digest('hex');
}

/** 학습 저장 트랜잭션 안에서만 보상하고 지급 대상·날짜는 서버가 결정한다. */
export async function awardLearningReward(
  tx: EntityManager,
  ownerId: string,
  kind: 'video' | 'exercise' | 'review',
  target: string,
  attemptId: string,
  assisted = false,
  savedAt?: Date
) {
  // 계정별 잠금으로 서로 다른 학습의 동시 제출도 일일 한도를 공유한다.
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `growth:${ownerId}`,
  ]);

  const [{ now }] = await tx.query('SELECT clock_timestamp() AS now');
  const { day } = growthCalendar(new Date(now));

  if (kind === 'review' && (!savedAt || growthCalendar(savedAt).day >= day))
    return null;

  const [totals] = await tx.query(
    `SELECT
    COALESCE(sum(xp),0)::int AS total,
    COALESCE(sum(xp) FILTER (WHERE day=$2 AND kind<>'daily'),0)::int AS today
    FROM "LearningReward" WHERE "ownerId"=$1`,
    [ownerId, day]
  );

  const xp = Math.min(
    kind === 'review' || assisted ? 5 : 10,
    growthPolicy.dailyLimit - totals.today
  );

  if (xp <= 0) return null;

  const rows = await tx.query(
    `INSERT INTO "LearningReward" ("ownerId",kind,target,period,xp,day,"rulesVersion","attemptId")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
    [
      ownerId,
      kind,
      target,
      kind === 'review' ? day : '',
      xp,
      day,
      growthPolicy.version,
      attemptId,
    ]
  );

  if (!rows.length) return null;

  const [{ count }] = await tx.query(
    `SELECT count(*)::int AS count FROM "LearningReward"
    WHERE "ownerId"=$1 AND day=$2 AND kind<>'daily'`,
    [ownerId, day]
  );

  let dailyBonus = 0;

  if (count >= growthPolicy.dailyGoal) {
    const bonus = await tx.query(
      `INSERT INTO "LearningReward" ("ownerId",kind,target,period,xp,day,"rulesVersion")
      VALUES ($1,'daily',$2::text,'',$3,$2::text::date,$4) ON CONFLICT DO NOTHING RETURNING id`,
      [ownerId, day, growthPolicy.dailyBonus, growthPolicy.version]
    );

    if (bonus.length) dailyBonus = growthPolicy.dailyBonus;
  }

  const totalXp = totals.total + xp + dailyBonus;

  const receipt = {
    id: rows[0].id as string,
    xp,
    dailyBonus,
    totalXp,
    previousLevel: growthLevel(totals.total).level,
    ...growthLevel(totalXp),
    dailyCompleted: count,
    dailyGoal: growthPolicy.dailyGoal,
  };

  await tx.query('UPDATE "LearningReward" SET receipt=$2 WHERE id=$1', [
    receipt.id,
    receipt,
  ]);

  return receipt;
}

/** 응답 유실 후 같은 제출을 다시 보내면 당시 영수증을 그대로 돌려준다. */
export async function learningRewardReceipt(
  tx: EntityManager,
  ownerId: string,
  attemptId: string
) {
  const [row] = await tx.query(
    'SELECT receipt FROM "LearningReward" WHERE "ownerId"=$1 AND "attemptId"=$2',
    [ownerId, attemptId]
  );

  return (row?.receipt ?? null) as Awaited<
    ReturnType<typeof awardLearningReward>
  >;
}
