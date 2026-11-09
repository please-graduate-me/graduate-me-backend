import { EntitySchema } from 'typeorm';

/** MaterialReading의 계정·출처·버전 연결을 저장한다. */
export interface MaterialReading {
  id: string;
  ownerId: string;
  materialId: string;
  currentPage: number;
  memo: string;
  updatedAt: Date;
}

/** 생성 결과와 개인 기록의 저장 경계를 보존한다. */
export const MaterialReading = new EntitySchema<MaterialReading>({
  name: 'MaterialReading',
  tableName: 'MaterialReading',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    ownerId: {
      type: 'text',
    },
    materialId: {
      type: 'text',
    },
    currentPage: {
      type: 'integer',
      default: 1,
    },
    memo: {
      type: 'text',
      default: () => "''",
    },
    updatedAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'now()',
      updateDate: true,
    },
  },
  foreignKeys: [
    {
      name: 'MaterialReading_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    {
      name: 'MaterialReading_materialId_fkey',
      target: 'Material',
      columnNames: ['materialId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  ],
  indices: [],
  uniques: [
    {
      name: 'MaterialReading_ownerId_materialId_key',
      columns: ['ownerId', 'materialId'],
    },
  ],
});
