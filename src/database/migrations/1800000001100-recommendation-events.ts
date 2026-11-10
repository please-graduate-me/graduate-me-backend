import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 추천 노출과 선택을 사용자별 실제 이벤트로 보존한다. */
export class RecommendationEvents1800000001100 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(
      `ALTER TABLE "CourseAssignment" DROP CONSTRAINT "CourseAssignment_mode_check", ADD CONSTRAINT "CourseAssignment_mode_check" CHECK(mode IN ('full','blank','reading'))`
    );

    await runner.query(`CREATE TABLE "RecommendationEvent" (
      id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      "videoId" text NOT NULL REFERENCES "Video"(id) ON DELETE CASCADE, action text NOT NULL CHECK(action IN ('shown','selected')),
      "createdAt" timestamp(3) NOT NULL DEFAULT now())`);
  }
  async down(): Promise<void> {
    throw new Error('추천 이력 보호를 위해 후속 마이그레이션을 사용해 주세요.');
  }
}
