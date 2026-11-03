import type { MigrationInterface, QueryRunner } from 'typeorm';
import { applyLegacyMigration } from '../legacy-migration.js';

/** 기존 변경 이력을 확인해 새 DB와 기존 DB에 같은 스키마를 구성한다. */
export class Schema1793498400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await applyLegacyMigration(
      runner,
      '20261101020000_user_learning_settings',
      'ALTER TABLE "User" ADD COLUMN "autoReplay" BOOLEAN NOT NULL DEFAULT false;\nALTER TABLE "User" ADD COLUMN "replayDelay" INTEGER NOT NULL DEFAULT 1,\n    ADD COLUMN "replayCount" INTEGER,\n    ADD COLUMN "playbackRate" DOUBLE PRECISION NOT NULL DEFAULT 1;\n'
    );
  }
  async down(): Promise<void> {
    throw new Error(
      '기존 데이터 보호를 위해 후속 마이그레이션으로 변경을 되돌려 주세요.'
    );
  }
}
