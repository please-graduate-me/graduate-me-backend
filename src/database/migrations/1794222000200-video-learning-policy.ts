import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 언어별 분석과 비율별 답안을 분리하고 기존 전사 자료를 재분석하지 않는다. */
export class VideoLearningPolicy1794222000200 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE "Video" ADD "language" text NOT NULL DEFAULT 'en', ADD "analysisVersion" text NOT NULL DEFAULT 'v1', ADD "ownerId" text, ADD "visibility" text NOT NULL DEFAULT 'public', ADD "translationStatus" text NOT NULL DEFAULT 'pending', ADD "blankStatus" text NOT NULL DEFAULT 'pending', ADD "processingError" text`
    );

    await runner.query(
      `ALTER TABLE "Video" ADD CONSTRAINT "Video_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE`
    );

    await runner.query(
      `ALTER TABLE "Video" ADD "allowedUserIds" jsonb NOT NULL DEFAULT '[]'::jsonb, ADD "version" integer NOT NULL DEFAULT 1`
    );

    await runner.query(`DROP INDEX "Video_youtubeId_key"`);

    await runner.query(
      `CREATE UNIQUE INDEX "Video_youtubeId_language_analysisVersion_key" ON "Video" ("youtubeId", "language", "analysisVersion")`
    );

    await runner.query(
      `ALTER TABLE "Segment" ADD "translation" text, ADD "blankCandidates" jsonb, ADD "version" integer NOT NULL DEFAULT 1`
    );

    await runner.query(
      `ALTER TABLE "Progress" ADD "blankRatio" integer NOT NULL DEFAULT 20, ADD "cycle" integer NOT NULL DEFAULT 0, ADD "scriptViewed" boolean NOT NULL DEFAULT false`
    );

    await runner.query(
      `ALTER TABLE "SegmentState" ADD "blankRatio" integer NOT NULL DEFAULT 20, ADD "hintCount" integer NOT NULL DEFAULT 0, ADD "sourceVersion" integer NOT NULL DEFAULT 1`
    );

    await runner.query(
      `UPDATE "SegmentState" SET "blankRatio" = 0 WHERE mode = 'full'`
    );

    await runner.query(
      `DROP INDEX "SegmentState_progressId_segmentId_mode_key"`
    );

    await runner.query(
      `CREATE UNIQUE INDEX "SegmentState_progressId_segmentId_mode_blankRatio_version_key" ON "SegmentState" ("progressId", "segmentId", mode, "blankRatio", "sourceVersion")`
    );

    await runner.query(
      `UPDATE "Attempt" a SET result = a.result || jsonb_build_object('sourceText', s.text, 'sourceVersion', 1, 'blankRatio', CASE WHEN a.mode = 'full' THEN 0 ELSE 20 END, 'rulesVersion', 'legacy-normalized-v0', 'revealed', COALESCE((SELECT bool_or(st.revealed) FROM "SegmentState" st WHERE st."progressId" = a."progressId" AND st."segmentId" = a."segmentId" AND st.mode = a.mode), false), 'hintCount', 0, 'cycle', 0) FROM "Segment" s WHERE s.id = a."segmentId" AND NOT (a.result ? 'sourceText')`
    );

    await runner.query(
      `UPDATE "Video" SET "translationStatus" = 'failed', "blankStatus" = 'failed', "processingError" = '기존 자료는 전사만 보존되어 있습니다. 자동 재분석은 하지 않습니다.' WHERE id IN (SELECT "videoId" FROM "Job" WHERE status = 'ready')`
    );

    await runner.query(
      `UPDATE "Job" SET status = 'failed', "leaseToken" = NULL, "heartbeatAt" = NULL, "errorCode" = 'WORKER_INTERRUPTED', "errorMessage" = '분석 정책 변경 시 진행 중이던 요청입니다. 자동 재시도하지 않습니다.' WHERE status IN ('preparing', 'transcribing') OR (status = 'queued' AND attempts > 0)`
    );
  }
  async down(): Promise<void> {
    throw new Error(
      '과거 답안과 분석 결과를 보존하기 위해 후속 마이그레이션으로 변경해 주세요.'
    );
  }
}
