import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 교사 탈퇴가 수업에 제출한 다른 학생의 답안과 과제 버전을 연쇄 삭제하지 않게 한다. */
export class CourseOwnerPreservation1800000001400 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`ALTER TABLE "Course" DROP CONSTRAINT "Course_ownerId_fkey", ALTER COLUMN "ownerId" DROP NOT NULL,
      ADD CONSTRAINT "Course_ownerId_fkey" FOREIGN KEY("ownerId") REFERENCES "User"(id) ON DELETE SET NULL`);
  }
  async down(): Promise<void> {
    throw new Error(
      '타인 제출 기록을 보호하기 위해 후속 마이그레이션으로 변경해 주세요.'
    );
  }
}
