import type { MigrationInterface, QueryRunner } from 'typeorm';

/** PDF 원본 버전별 정리 결과와 복구 가능한 작업 상태를 저장한다. */
export class MaterialAnalysis1800000001500 implements MigrationInterface {
  name = 'MaterialAnalysis1800000001500';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE "MaterialAnalysis" (
      id text NOT NULL DEFAULT gen_random_uuid(), "materialId" text NOT NULL, version integer NOT NULL, "ownerId" text NOT NULL,
      "explanationLanguage" text NOT NULL, status text NOT NULL DEFAULT 'queued', pages jsonb NOT NULL DEFAULT '[]', overview jsonb, error text,
      "requestId" text, "leaseToken" text, "heartbeatAt" timestamp(3),
      "createdAt" timestamp(3) NOT NULL DEFAULT now(), "updatedAt" timestamp(3) NOT NULL DEFAULT now(),
      CONSTRAINT "MaterialAnalysis_pkey" PRIMARY KEY(id),
      CONSTRAINT "MaterialAnalysis_source_fkey" FOREIGN KEY("materialId",version) REFERENCES "MaterialVersion"("materialId",version) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "MaterialAnalysis_ownerId_fkey" FOREIGN KEY("ownerId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "MaterialAnalysis_materialId_version_key" UNIQUE("materialId",version),
      CONSTRAINT "MaterialAnalysis_requestId_key" UNIQUE("requestId"),
      CONSTRAINT "MaterialAnalysis_status_check" CHECK(status IN ('queued','running','ready','partial','failed','skipped')),
      CONSTRAINT "MaterialAnalysis_language_check" CHECK("explanationLanguage" IN ('ko','en','th')),
      CONSTRAINT "MaterialAnalysis_version_check" CHECK(version > 0)
    )`);

    await runner.query(
      'CREATE INDEX "MaterialAnalysis_status_createdAt_idx" ON "MaterialAnalysis"(status,"createdAt")'
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE "MaterialAnalysis"');
  }
}
