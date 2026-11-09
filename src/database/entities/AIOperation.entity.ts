import { EntitySchema } from 'typeorm';

/** AIOperation의 계정·출처·버전 연결을 저장한다. */
export interface AIOperation {
  id: string;
  ownerId: string;
  task: string;
  fingerprint: string;
  status: 'running' | 'succeeded' | 'failed';
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 생성 결과와 개인 기록의 저장 경계를 보존한다. */
export const AIOperation = new EntitySchema<AIOperation>({
  name: 'AIOperation',
  tableName: 'AIOperation',
  columns: {
    id: {
      type: 'text',
      primary: true,
    },
    ownerId: {
      type: 'text',
    },
    task: {
      type: 'text',
    },
    fingerprint: {
      type: 'text',
    },
    status: {
      type: 'text',
    },
    result: {
      type: 'jsonb',
      nullable: true,
    },
    error: {
      type: 'text',
      nullable: true,
    },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'now()',
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
      name: 'AIOperation_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  ],
  indices: [
    {
      name: 'AIOperation_ownerId_createdAt_idx',
      columns: ['ownerId', 'createdAt'],
    },
  ],
  uniques: [],
});
