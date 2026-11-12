import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { growthCalendar, growthLevel, growthPolicy } from './policy.js';

/** 공개 닉네임만 순위에 노출하고 개인 XP는 참여 여부와 분리한다. */
@Injectable()
export class GrowthService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async summary(ownerId: string) {
    const { day, weekStart } = growthCalendar();

    const [totals] = await this.db.query(
      `SELECT COALESCE(sum(xp),0)::int AS total,
      COALESCE(sum(xp) FILTER (WHERE day >= $3),0)::int AS weekly,
      COALESCE(sum(xp) FILTER (WHERE day=$2 AND kind<>'daily'),0)::int AS today,
      count(*) FILTER (WHERE day=$2 AND kind<>'daily')::int AS completed,
      count(*) FILTER (WHERE day=$2 AND kind='daily')::int AS goal
      FROM "LearningReward" WHERE "ownerId"=$1`,
      [ownerId, day, weekStart]
    );

    const [profile] = await this.db.query(
      'SELECT nickname,participating FROM "GrowthProfile" WHERE "ownerId"=$1',
      [ownerId]
    );

    const days: { day: string }[] = await this.db.query(
      `SELECT day::text FROM "LearningReward"
      WHERE "ownerId"=$1 AND kind='daily' ORDER BY day DESC`,
      [ownerId]
    );

    let streak = 0;
    const cursor = new Date(`${day}T00:00:00Z`);

    if (days[0]?.day !== day) cursor.setUTCDate(cursor.getUTCDate() - 1);

    for (const item of days) {
      if (item.day !== cursor.toISOString().slice(0, 10)) break;
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    return {
      totalXp: totals.total,
      weeklyXp: totals.weekly,
      todayXp: totals.today,
      ...growthLevel(totals.total),
      dailyCompleted: totals.completed,
      dailyGoal: growthPolicy.dailyGoal,
      dailyGoalReached: totals.goal > 0,
      dailyLimit: growthPolicy.dailyLimit,
      streak,
      day,
      weekStart,
      nickname: profile?.nickname ?? '',
      participating: profile?.participating ?? false,
    };
  }
  async preferences(ownerId: string, nickname: string, participating: boolean) {
    await this.db.query(
      `INSERT INTO "GrowthProfile" ("ownerId",nickname,participating) VALUES ($1,$2,$3)
      ON CONFLICT ("ownerId") DO UPDATE SET nickname=$2,participating=$3`,
      [ownerId, nickname, participating]
    );

    return this.summary(ownerId);
  }
  async leaderboard(ownerId: string) {
    const { weekStart } = growthCalendar();

    // 공개 프로필만 집계하며 동점의 순위와 표시 순서를 분리한다.
    const rows = await this.db.query(
      `WITH scores AS (
      SELECT p."ownerId",p.nickname,sum(r.xp)::int AS xp
      FROM "GrowthProfile" p JOIN "LearningReward" r ON r."ownerId"=p."ownerId"
      WHERE p.participating AND r.day >= $2 GROUP BY p."ownerId",p.nickname
    ), ranked AS (
      SELECT *,rank() OVER (ORDER BY xp DESC)::int AS rank,
      row_number() OVER (ORDER BY xp DESC,"ownerId")::int AS position FROM scores
    ) SELECT nickname,xp,rank,position,("ownerId"=$1) AS "isMe"
      FROM ranked WHERE position <= 20 OR abs(position-(SELECT position FROM ranked WHERE "ownerId"=$1))<=2
      ORDER BY position`,
      [ownerId, weekStart]
    );

    return { weekStart, items: rows };
  }
}
