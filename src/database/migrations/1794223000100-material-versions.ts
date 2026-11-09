import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';

/** 최초 원본을 보존하고 이후 PDF 교체가 불변 버전을 추가하도록 한다. */
export class MaterialVersions1794223000100 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.createTable(
      new Table({
        name: 'MaterialVersion',
        columns: [
          {
            name: 'id',
            type: 'text',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          { name: 'materialId', type: 'text' },
          { name: 'version', type: 'integer' },
          { name: 'content', type: 'bytea' },
          { name: 'pages', type: 'jsonb' },
          { name: 'filename', type: 'text' },
          { name: 'title', type: 'text' },
          { name: 'language', type: 'text' },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
        ],
        foreignKeys: [
          {
            name: 'MaterialVersion_materialId_fkey',
            columnNames: ['materialId'],
            referencedTableName: 'Material',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        ],
        uniques: [
          {
            name: 'MaterialVersion_materialId_version_key',
            columnNames: ['materialId', 'version'],
          },
        ],
      })
    );

    await runner.query(
      `INSERT INTO "MaterialVersion" ("materialId", "version", "content", "pages", "filename", "title", "language", "createdAt") SELECT "id", "version", "content", "pages", "filename", "title", "language", "createdAt" FROM "Material"`
    );
  }
  async down(): Promise<void> {
    throw new Error(
      '학습 근거 원본을 보호하기 위해 후속 마이그레이션으로 변경해 주세요.'
    );
  }
}
