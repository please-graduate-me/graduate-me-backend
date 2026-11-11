import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 개인 질문을 공개하지 않고 커뮤니티 태그와 독립 운영 세션을 추가한다. */
export class CommunityHelpersAdmin1800000001600 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(
      `ALTER TABLE "CommunityPost" ADD COLUMN "taggedHelperIds" jsonb NOT NULL DEFAULT '[]'`
    );

    await runner.query(
      `CREATE INDEX ON "CommunityPost" USING gin ("taggedHelperIds")`
    );

    await runner.query(`CREATE TABLE "AdminOperator" (
      username text PRIMARY KEY, "userId" text NOT NULL UNIQUE REFERENCES "User"(id) ON DELETE CASCADE)`);

    await runner.query(`CREATE TABLE "AdminSession" (
      "tokenHash" text PRIMARY KEY, username text NOT NULL REFERENCES "AdminOperator"(username) ON DELETE CASCADE,
      "credentialHash" text NOT NULL, "expiresAt" timestamp(3) NOT NULL)`);

    await runner.query(`CREATE INDEX ON "AdminSession"("expiresAt")`);

    await runner.query(`CREATE TABLE "AdminLoginAttempt" (
      key text PRIMARY KEY, attempts integer NOT NULL, "startedAt" timestamp(3) NOT NULL DEFAULT now())`);
  }
  async down(): Promise<void> {
    throw new Error(
      '기존 기록 보호를 위해 후속 마이그레이션으로 변경해 주세요.'
    );
  }
}
