import type { MigrationInterface, QueryRunner } from 'typeorm';
import { applyLegacyMigration } from '../legacy-migration.js';

/** 기존 변경 이력을 확인해 새 DB와 기존 DB에 같은 스키마를 구성한다. */
export class Schema1793491200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await applyLegacyMigration(
      runner,
      '20261101000000_video_metadata',
      'ALTER TABLE "Video" ADD COLUMN "downloadedAt" TIMESTAMP(3);\nALTER TABLE "Video" ADD COLUMN "category" TEXT, ADD COLUMN "youtubeCategoryId" TEXT;\n\nCREATE TABLE "VideoLike" (\n    "userId" TEXT NOT NULL,\n    "videoId" TEXT NOT NULL,\n    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    CONSTRAINT "VideoLike_pkey" PRIMARY KEY ("userId", "videoId"),\n    CONSTRAINT "VideoLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,\n    CONSTRAINT "VideoLike_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE\n);\nCREATE INDEX "VideoLike_videoId_idx" ON "VideoLike"("videoId");\n'
    );
  }
  async down(): Promise<void> {
    throw new Error(
      '기존 데이터 보호를 위해 후속 마이그레이션으로 변경을 되돌려 주세요.'
    );
  }
}
