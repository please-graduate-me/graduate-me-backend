import { EntitySchema } from 'typeorm';

/** PDF 교체 후에도 과거 원본·페이지·표시 언어를 당시 버전으로 보존한다. */
export interface MaterialVersion {
  id: string;
  materialId: string;
  version: number;
  content: Buffer;
  pages: string[];
  filename: string;
  title: string;
  language: 'en' | 'th';
  createdAt: Date;
}

/** PDF 원본 버전은 개인 메모나 읽기 위치를 포함하지 않는다. */
export const MaterialVersion = new EntitySchema<MaterialVersion>({
  name: 'MaterialVersion',
  tableName: 'MaterialVersion',
  columns: {
    id: { type: 'text', primary: true, default: () => 'gen_random_uuid()' },
    materialId: { type: 'text' },
    version: { type: 'integer' },
    content: { type: 'bytea', select: false },
    pages: { type: 'jsonb' },
    filename: { type: 'text' },
    title: { type: 'text' },
    language: { type: 'text' },
    createdAt: { type: 'timestamp', precision: 3, default: () => 'now()' },
  },
  foreignKeys: [
    {
      name: 'MaterialVersion_materialId_fkey',
      target: 'Material',
      columnNames: ['materialId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  ],
  uniques: [
    {
      name: 'MaterialVersion_materialId_version_key',
      columns: ['materialId', 'version'],
    },
  ],
});
