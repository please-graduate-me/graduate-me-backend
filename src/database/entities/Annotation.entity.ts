import { EntitySchema } from 'typeorm';
import type { LearningSource } from '../../learning/contracts.js';

/** Annotation의 계정·출처·버전 연결을 저장한다. */
export interface Annotation {
  id: string;
  ownerId: string;
  source: LearningSource;
  color: 'yellow' | 'blue' | 'green';
  memo: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 생성 결과와 개인 기록의 저장 경계를 보존한다. */
export const Annotation = new EntitySchema<Annotation>({
  name: 'Annotation',
  tableName: 'Annotation',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    ownerId: {
      type: 'text',
    },
    source: {
      type: 'jsonb',
    },
    color: {
      type: 'text',
    },
    memo: {
      type: 'text',
      default: () => "''",
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
      name: 'Annotation_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  ],
  indices: [
    {
      name: 'Annotation_ownerId_updatedAt_idx',
      columns: ['ownerId', 'updatedAt'],
    },
  ],
  uniques: [],
});
