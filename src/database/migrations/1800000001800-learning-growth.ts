import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 학습 기록과 독립된 보상 원장과 선택 공개 프로필을 보존한다. */
export class LearningGrowth1800000001800 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE "LearningReward" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "ownerId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('video','exercise','review','daily')),
      target text NOT NULL, "attemptId" text, receipt jsonb, period text NOT NULL DEFAULT '',
      xp integer NOT NULL CHECK (xp > 0),
      day date NOT NULL, "rulesVersion" text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("ownerId",kind,target,period)
    )`);

    await runner.query(
      `CREATE INDEX "LearningReward_owner_day_idx" ON "LearningReward" ("ownerId",day)`
    );

    await runner.query(
      `CREATE INDEX "LearningReward_day_idx" ON "LearningReward" (day)`
    );

    await runner.query(
      `CREATE INDEX "LearningReward_owner_attempt_idx" ON "LearningReward" ("ownerId","attemptId")`
    );

    await runner.query(`CREATE TABLE "GrowthProfile" (
      "ownerId" text PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
      nickname text NOT NULL, participating boolean NOT NULL DEFAULT false
    )`);
  }
  async down(runner: QueryRunner) {
    await runner.query('DROP TABLE "GrowthProfile"');
    await runner.query('DROP TABLE "LearningReward"');
  }
}
