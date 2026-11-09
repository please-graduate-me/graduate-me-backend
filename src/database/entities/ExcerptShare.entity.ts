import { EntitySchema } from 'typeorm';
import type { LearningSource } from '../../learning/contracts.js';

/** ExcerptShare의 계정·출처·버전 연결을 저장한다. */
export interface ExcerptShare {
  id: string;
  ownerId: string;
  source: LearningSource;
  visibility: 'link' | 'accounts';
  allowedUserIds: string[];
  revokedAt: Date | null;
  createdAt: Date;
}

/** 생성 결과와 개인 기록의 저장 경계를 보존한다. */
export const ExcerptShare = new EntitySchema<ExcerptShare>({
  name: 'ExcerptShare',
  tableName: 'ExcerptShare',
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
    visibility: {
      type: 'text',
    },
    allowedUserIds: {
      type: 'jsonb',
    },
    revokedAt: {
      type: 'timestamp',
      precision: 3,
      nullable: true,
    },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'now()',
    },
  },
  foreignKeys: [
    {
      name: 'ExcerptShare_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  ],
  indices: [
    {
      name: 'ExcerptShare_ownerId_createdAt_idx',
      columns: ['ownerId', 'createdAt'],
    },
  ],
  uniques: [],
});
