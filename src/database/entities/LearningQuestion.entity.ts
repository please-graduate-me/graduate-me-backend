import { EntitySchema } from 'typeorm';
import type { LearningSource } from '../../learning/contracts.js';

/** 질문의 공개 내용과 admin 내부 초안·메모를 저장 단계에서도 구분한다. */
export interface LearningQuestion {
  id: string;
  ownerId: string;
  title: string;
  body: string;
  source: LearningSource;
  status: 'waiting' | 'answered';
  assigneeId: string | null;
  draft: string;
  internalNote: string;
  kind: 'question' | 'report';
  resolvedAt: Date | null;
  revokedAt: Date | null;
  attachment: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 질문의 공개 내용과 admin 내부 초안·메모를 저장 단계에서도 구분한다. */
export const LearningQuestion = new EntitySchema<LearningQuestion>({
  name: 'LearningQuestion',
  tableName: 'LearningQuestion',
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
    body: {
      type: 'text',
    },
    source: {
      type: 'jsonb',
    },
    status: {
      type: 'text',
      default: () => "'waiting'",
    },
    assigneeId: {
      type: 'text',
      nullable: true,
    },
    draft: {
      type: 'text',
      default: () => "''",
    },
    internalNote: {
      type: 'text',
      default: () => "''",
    },
    kind: { type: 'text', default: 'question' },
    resolvedAt: { type: 'timestamp', precision: 3, nullable: true },
    revokedAt: { type: 'timestamp', precision: 3, nullable: true },
    attachment: { type: 'jsonb', nullable: true },
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
      name: 'LearningQuestion_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    {
      name: 'LearningQuestion_assigneeId_fkey',
      target: 'User',
      columnNames: ['assigneeId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  ],
  indices: [
    {
      name: 'LearningQuestion_ownerId_updatedAt_idx',
      columns: ['ownerId', 'updatedAt'],
    },
    {
      name: 'LearningQuestion_assigneeId_status_idx',
      columns: ['assigneeId', 'status'],
    },
  ],
});
