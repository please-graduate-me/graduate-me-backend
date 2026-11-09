import { EntitySchema } from 'typeorm';

/** 원본을 삭제해도 당일 신규 등록 횟수가 초기화되지 않게 한다. */
export interface MaterialRegistration {
  materialId: string;
  ownerId: string;
  createdAt: Date;
}

/** PDF 본문 없이 등록 시각과 소유자만 일일 한도에 사용한다. */
export const MaterialRegistration = new EntitySchema<MaterialRegistration>({
  name: 'MaterialRegistration',
  tableName: 'MaterialRegistration',
  columns: {
    materialId: { type: 'text', primary: true },
    ownerId: { type: 'text' },
    createdAt: { type: 'timestamp', precision: 3, default: () => 'now()' },
  },
  foreignKeys: [
    {
      name: 'MaterialRegistration_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  ],
  indices: [
    {
      name: 'MaterialRegistration_ownerId_createdAt_idx',
      columns: ['ownerId', 'createdAt'],
    },
  ],
});
