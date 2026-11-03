import type { MigrationInterface, QueryRunner } from 'typeorm';
import { applyLegacyMigration } from '../legacy-migration.js';

/** 기존 변경 이력을 확인해 새 DB와 기존 DB에 같은 스키마를 구성한다. */
export class Schema1793494800000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await applyLegacyMigration(
      runner,
      '20261101010000_video_library',
      'ALTER TABLE "Progress" ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false,\n    ADD COLUMN "archivedAt" TIMESTAMP(3);\nCREATE TABLE "SegmentDifficulty" (\n    "progressId" TEXT NOT NULL,\n    "segmentId" TEXT NOT NULL,\n    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    CONSTRAINT "SegmentDifficulty_pkey" PRIMARY KEY ("progressId", "segmentId"),\n    CONSTRAINT "SegmentDifficulty_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "Progress"("id") ON DELETE CASCADE ON UPDATE CASCADE,\n    CONSTRAINT "SegmentDifficulty_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE\n);\n'
    );
  }
  async down(): Promise<void> {
    throw new Error(
      '기존 데이터 보호를 위해 후속 마이그레이션으로 변경을 되돌려 주세요.'
    );
  }
}
