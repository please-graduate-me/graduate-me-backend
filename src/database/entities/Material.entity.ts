import { EntitySchema } from 'typeorm';

/** 원본 PDF와 계정별 읽기 위치를 외부 저장소 없이 보존한다. */
export interface Material {
  id: string;
  ownerId: string;
  title: string;
  language: 'en' | 'th';
  filename: string;
  content: Buffer;
  pages: string[];
  currentPage: number;
  memo: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 원본 PDF와 계정별 읽기 위치를 외부 저장소 없이 보존한다. */
export const Material = new EntitySchema<Material>({
  name: 'Material',
  tableName: 'Material',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    ownerId: {
      type: 'text',
    },
    title: {
      type: 'text',
    },
    language: {
      type: 'text',
    },
    filename: {
      type: 'text',
    },
    content: {
      type: 'bytea',
      select: false,
    },
    pages: {
      type: 'jsonb',
    },
    currentPage: {
      type: 'integer',
      default: 1,
    },
    memo: {
      type: 'text',
      default: () => "''",
    },
    version: { type: 'integer', default: 1 },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'CURRENT_TIMESTAMP',
    },
    updatedAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'CURRENT_TIMESTAMP',
      updateDate: true,
    },
  },
  foreignKeys: [
    {
      name: 'Material_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  ],
  indices: [
    {
      name: 'Material_ownerId_updatedAt_idx',
      columns: ['ownerId', 'updatedAt'],
    },
  ],
});
