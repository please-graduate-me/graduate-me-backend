import { EntitySchema } from 'typeorm';
import type { LearningSource } from '../../learning/contracts.js';

/** AIConversation의 계정·출처·버전 연결을 저장한다. */
export interface AIConversation {
  id: string;
  ownerId: string;
  source: LearningSource;
  createdAt: Date;
  updatedAt: Date;
}

/** 생성 결과와 개인 기록의 저장 경계를 보존한다. */
export const AIConversation = new EntitySchema<AIConversation>({
  name: 'AIConversation',
  tableName: 'AIConversation',
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
      name: 'AIConversation_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  ],
  indices: [
    {
      name: 'AIConversation_ownerId_updatedAt_idx',
      columns: ['ownerId', 'updatedAt'],
    },
  ],
  uniques: [],
});
