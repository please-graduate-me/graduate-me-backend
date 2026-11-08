import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 현재 영상 분석에서 사용하지 않는 저장 상태를 스키마에서도 제거한다. */
export class RemoveAudioProcessing1794146400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `UPDATE "Job" SET status = 'preparing' WHERE status = 'extracting'`
    );

    await runner.query(`ALTER TABLE "Video"
      DROP COLUMN "downloadedAt", DROP COLUMN "speechRegions",
      DROP COLUMN "speechFilterVersion", DROP COLUMN "speechCheckedAt"`);

    await runner.query(`ALTER TABLE "Segment"
      DROP COLUMN "excluded", DROP COLUMN "exclusionReason"`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `UPDATE "Job" SET status = 'extracting' WHERE status = 'preparing'`
    );

    await runner.query(`ALTER TABLE "Video"
      ADD COLUMN "downloadedAt" TIMESTAMP(3), ADD COLUMN "speechRegions" JSONB,
      ADD COLUMN "speechFilterVersion" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN "speechCheckedAt" TIMESTAMP(3)`);

    await runner.query(`ALTER TABLE "Segment"
      ADD COLUMN "excluded" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN "exclusionReason" TEXT`);
  }
}
