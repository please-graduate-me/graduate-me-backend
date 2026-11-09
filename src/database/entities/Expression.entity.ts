import { EntitySchema } from 'typeorm';
import type { LearningSource } from '../../learning/contracts.js';

/** 개인 표현과 저장 당시의 원문 발췌를 함께 보존한다. */
export interface Expression {
  id: string;
  ownerId: string;
  text: string;
  meaning: string;
  note: string;
  source: LearningSource;
  createdAt: Date;
  updatedAt: Date;
}

/** 개인 표현과 저장 당시의 원문 발췌를 함께 보존한다. */
export const Expression = new EntitySchema<Expression>({
  name: 'Expression',
  tableName: 'Expression',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    ownerId: {
      type: 'text',
    },
    text: {
      type: 'text',
    },
    meaning: {
      type: 'text',
      default: () => "''",
    },
    note: {
      type: 'text',
      default: () => "''",
    },
    source: {
      type: 'jsonb',
    },
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
      name: 'Expression_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  ],
  indices: [
    {
      name: 'Expression_ownerId_updatedAt_idx',
      columns: ['ownerId', 'updatedAt'],
    },
  ],
});
