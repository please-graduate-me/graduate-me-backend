import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 실제 재생 시각과 스크립트 위치를 기존 정답 진도에 영향을 주지 않는 저장 경계로 추가한다. */
export class VideoPlayback1800000001300 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE "VideoPlayback" (
      "progressId" text NOT NULL, "watchVersion" text NOT NULL, "analysisVersion" text NOT NULL, "sourceSnapshot" jsonb NOT NULL,
      cycle integer NOT NULL, "playbackPosition" double precision NOT NULL DEFAULT 0, "scriptPosition" double precision NOT NULL DEFAULT 0,
      "scriptMaxPosition" double precision NOT NULL DEFAULT 0, revision integer NOT NULL, "lastRequestId" text NOT NULL, "lastInput" jsonb NOT NULL,
      "updatedAt" timestamp(3) NOT NULL DEFAULT now(), PRIMARY KEY("progressId","watchVersion"),
      CONSTRAINT "VideoPlayback_progressId_fkey" FOREIGN KEY("progressId") REFERENCES "Progress"(id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "VideoPlayback_position_check" CHECK("playbackPosition" >= 0 AND "scriptPosition" >= 0 AND "scriptMaxPosition" >= "scriptPosition" AND revision > 0 AND cycle >= 0))`);
  }
  async down(): Promise<void> {
    throw new Error(
      '시청 이력 보존을 위해 후속 마이그레이션으로 변경해 주세요.'
    );
  }
}
