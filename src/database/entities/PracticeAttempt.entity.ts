import { EntitySchema } from 'typeorm';
import type { LearningSource } from '../../learning/contracts.js';

/** 자가점검 당시의 표현·뜻·출처를 스냅샷으로 보존한다. */
export interface PracticeAttempt {
  id: string;
  ownerId: string;
  expressionId: string;
  answer: string;
  correct: boolean;
  mode: 'self';
  snapshot: { text: string; meaning: string; source: LearningSource };
  createdAt: Date;
}

/** 자가점검 당시의 표현·뜻·출처를 스냅샷으로 보존한다. */
export const PracticeAttempt = new EntitySchema<PracticeAttempt>({
  name: 'PracticeAttempt',
  tableName: 'PracticeAttempt',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    ownerId: {
      type: 'text',
    },
    expressionId: {
      type: 'text',
    },
    answer: {
      type: 'text',
    },
    correct: {
      type: 'boolean',
    },
    mode: {
      type: 'text',
      default: () => "'self'",
    },
    snapshot: {
      type: 'jsonb',
    },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'CURRENT_TIMESTAMP',
    },
  },
  foreignKeys: [
    {
      name: 'PracticeAttempt_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  ],
  indices: [
    {
      name: 'PracticeAttempt_ownerId_createdAt_idx',
      columns: ['ownerId', 'createdAt'],
    },
  ],
});
