import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 페이지 OCR을 원본 버전과 연결하고 완료 결과의 중복 저장을 막는다. */
export class MaterialOcr1794223000300 implements MigrationInterface {
  name = 'MaterialOcr1794223000300';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "MaterialOcrPage" (
      id text NOT NULL DEFAULT gen_random_uuid(), "materialId" text NOT NULL, version integer NOT NULL, page integer NOT NULL, "requestId" text NOT NULL,
      status text NOT NULL, text text NOT NULL DEFAULT '', fields jsonb NOT NULL DEFAULT '[]', width integer, height integer, "lowConfidenceCount" integer NOT NULL DEFAULT 0, error text,
      "createdAt" timestamp(3) NOT NULL DEFAULT now(), "updatedAt" timestamp(3) NOT NULL DEFAULT now(),
      CONSTRAINT "MaterialOcrPage_pkey" PRIMARY KEY (id),
      CONSTRAINT "MaterialOcrPage_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"(id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "MaterialOcrPage_materialId_version_page_key" UNIQUE ("materialId", version, page),
      CONSTRAINT "MaterialOcrPage_location_check" CHECK (version > 0 AND page BETWEEN 1 AND 200),
      CONSTRAINT "MaterialOcrPage_status_check" CHECK (status IN ('running', 'ready', 'failed'))
    )`);

    await queryRunner.query(
      'CREATE INDEX "MaterialOcrPage_status_updatedAt_idx" ON "MaterialOcrPage" (status, "updatedAt")'
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "MaterialOcrPage"');
  }
}
