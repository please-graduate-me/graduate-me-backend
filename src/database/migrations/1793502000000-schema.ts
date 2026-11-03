import type { MigrationInterface, QueryRunner } from 'typeorm';
import { applyLegacyMigration } from '../legacy-migration.js';

/** 기존 변경 이력을 확인해 새 DB와 기존 DB에 같은 스키마를 구성한다. */
export class Schema1793502000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await applyLegacyMigration(
      runner,
      '20261101030000_share_links',
      'CREATE TABLE "ShareLink" (\n  "id" TEXT NOT NULL PRIMARY KEY,\n  "videoId" TEXT NOT NULL REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE,\n  "segmentId" TEXT REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE,\n  "creatorId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,\n  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  "revokedAt" TIMESTAMP(3)\n);\nCREATE INDEX "ShareLink_createdAt_idx" ON "ShareLink"("createdAt");\nCREATE INDEX "ShareLink_creatorId_idx" ON "ShareLink"("creatorId");\nCREATE INDEX "ShareLink_videoId_idx" ON "ShareLink"("videoId");\nCREATE TABLE "ShareVisit" (\n  "shareId" TEXT NOT NULL REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE,\n  "visitId" TEXT NOT NULL,\n  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  PRIMARY KEY ("shareId", "visitId")\n);\nCREATE INDEX "ShareVisit_createdAt_idx" ON "ShareVisit"("createdAt");\nCREATE TABLE "ShareStart" (\n  "id" TEXT NOT NULL PRIMARY KEY,\n  "shareId" TEXT NOT NULL REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE,\n  "userId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,\n  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP\n);\nCREATE UNIQUE INDEX "ShareStart_shareId_userId_key" ON "ShareStart"("shareId", "userId");\nCREATE INDEX "ShareStart_createdAt_idx" ON "ShareStart"("createdAt");\n'
    );
  }
  async down(): Promise<void> {
    throw new Error(
      '기존 데이터 보호를 위해 후속 마이그레이션으로 변경을 되돌려 주세요.'
    );
  }
}
