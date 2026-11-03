import type { MigrationInterface, QueryRunner } from 'typeorm';
import { applyLegacyMigration } from '../legacy-migration.js';

/** 기존 변경 이력을 확인해 새 DB와 기존 DB에 같은 스키마를 구성한다. */
export class Schema1793664000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await applyLegacyMigration(
      runner,
      '20261103000000_default_blank_mode',
      'ALTER TABLE "Progress" ALTER COLUMN "mode" SET DEFAULT \'blank\';\n'
    );
  }
  async down(): Promise<void> {
    throw new Error(
      '기존 데이터 보호를 위해 후속 마이그레이션으로 변경을 되돌려 주세요.'
    );
  }
}
