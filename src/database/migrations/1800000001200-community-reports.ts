import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 게시물 신고와 숨김은 개인 학습 오류 신고와 구분하고 삭제 없이 처리한다. */
export class CommunityReports1800000001200 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(
      'ALTER TABLE "CommunityPost" ADD COLUMN "hiddenAt" timestamp(3)'
    );

    await runner.query(`CREATE TABLE "CommunityReport" (
      id text PRIMARY KEY DEFAULT gen_random_uuid(), "postId" text NOT NULL REFERENCES "CommunityPost"(id) ON DELETE CASCADE,
      "reporterId" text REFERENCES "User"(id) ON DELETE SET NULL, reason text NOT NULL,
      status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')), resolution text,
      "createdAt" timestamp(3) NOT NULL DEFAULT now(), "updatedAt" timestamp(3) NOT NULL DEFAULT now())`);

    await runner.query('CREATE INDEX ON "CommunityReport"(status,"createdAt")');
  }
  async down(): Promise<void> {
    throw new Error(
      '신고 이력 보존을 위해 후속 마이그레이션으로 변경해 주세요.'
    );
  }
}
