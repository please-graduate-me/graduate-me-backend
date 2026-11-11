import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 운영 비밀번호는 배포 시 해시로 시딩하고 기존 계정은 재시딩 전까지 비활성으로 둔다. */
export class AdminCredentials1800000001700 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(
      `ALTER TABLE "AdminOperator" ADD COLUMN "passwordHash" text NOT NULL DEFAULT ''`
    );
  }
  async down(): Promise<void> {
    throw new Error(
      '운영 계정 보호를 위해 후속 마이그레이션으로 변경해 주세요.'
    );
  }
}
