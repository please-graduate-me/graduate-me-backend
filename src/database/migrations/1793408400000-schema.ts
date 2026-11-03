import type { MigrationInterface, QueryRunner } from 'typeorm';
import { applyLegacyMigration } from '../legacy-migration.js';

/** 기존 변경 이력을 확인해 새 DB와 기존 DB에 같은 스키마를 구성한다. */
export class Schema1793408400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await applyLegacyMigration(
      runner,
      '20261031010000_speech_filter',
      '-- 말소리 검사 결과와 비파괴 구절 제외 상태를 저장한다.\nALTER TABLE "Video" ADD COLUMN "speechRegions" JSONB,\nADD COLUMN "speechFilterVersion" INTEGER NOT NULL DEFAULT 0,\nADD COLUMN "speechCheckedAt" TIMESTAMP(3);\nALTER TABLE "Segment" ADD COLUMN "excluded" BOOLEAN NOT NULL DEFAULT false,\nADD COLUMN "exclusionReason" TEXT;\n'
    );
  }
  async down(): Promise<void> {
    throw new Error(
      '기존 데이터 보호를 위해 후속 마이그레이션으로 변경을 되돌려 주세요.'
    );
  }
}
