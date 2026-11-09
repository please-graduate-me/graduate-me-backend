import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 기존 등록 시각을 유지하며 삭제와 무관한 일일 PDF 등록 한도를 구성한다. */
export class MaterialRegistration1794223000600 implements MigrationInterface {
  name = 'MaterialRegistration1794223000600';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "MaterialRegistration" (
      "materialId" text PRIMARY KEY, "ownerId" text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT now(),
      CONSTRAINT "MaterialRegistration_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE
    )`);

    await queryRunner.query(
      'CREATE INDEX "MaterialRegistration_ownerId_createdAt_idx" ON "MaterialRegistration" ("ownerId", "createdAt")'
    );

    await queryRunner.query(
      'INSERT INTO "MaterialRegistration" ("materialId", "ownerId", "createdAt") SELECT id, "ownerId", "createdAt" FROM "Material"'
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "MaterialRegistration"');
  }
}
