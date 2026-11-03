import type { MigrationInterface, QueryRunner } from 'typeorm';

const columns = [
  ['Video', 'createdAt'],
  ['VideoLike', 'createdAt'],
  ['Job', 'availableAt'],
  ['Job', 'createdAt'],
  ['Job', 'updatedAt'],
  ['ShareLink', 'createdAt'],
  ['ShareVisit', 'createdAt'],
  ['ShareStart', 'createdAt'],
  ['Progress', 'updatedAt'],
  ['SegmentDifficulty', 'createdAt'],
  ['SegmentState', 'updatedAt'],
  ['Attempt', 'createdAt'],
];

/** 동등한 시각 기본값 표기를 통일해 불필요한 스키마 변경 생성을 막는다. */
export class NormalizeDefaults1793664000002 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    for (const [table, column] of columns)
      await runner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT now()`
      );
  }
  async down(runner: QueryRunner): Promise<void> {
    for (const [table, column] of columns)
      await runner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT CURRENT_TIMESTAMP`
      );
  }
}
