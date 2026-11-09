import { EntitySchema } from 'typeorm';
import type { LearningSource } from '../../learning/contracts.js';

/** 구절·설명·문제 버전을 명시한 검토 요청과 처리 사유를 보존한다. */
export interface ReviewRequest {
  id: string;
  questionId: string;
  authorId: string | null;
  authorName: string;
  scope: 'source' | 'explanation' | 'question';
  version: string;
  reason: string;
  source: LearningSource;
  status: 'open' | 'resolved' | 'dismissed';
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 구절·설명·문제 버전을 명시한 검토 요청과 처리 사유를 보존한다. */
export const ReviewRequest = new EntitySchema<ReviewRequest>({
  name: 'ReviewRequest',
  tableName: 'ReviewRequest',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    questionId: {
      type: 'text',
    },
    authorId: {
      type: 'text',
      nullable: true,
    },
    authorName: {
      type: 'text',
    },
    scope: {
      type: 'text',
    },
    version: {
      type: 'text',
    },
    reason: {
      type: 'text',
    },
    source: {
      type: 'jsonb',
    },
    status: {
      type: 'text',
      default: () => "'open'",
    },
    resolution: {
      type: 'text',
      nullable: true,
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
      name: 'ReviewRequest_questionId_fkey',
      target: 'LearningQuestion',
      columnNames: ['questionId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    {
      name: 'ReviewRequest_authorId_fkey',
      target: 'User',
      columnNames: ['authorId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  ],
  indices: [
    {
      name: 'ReviewRequest_questionId_createdAt_idx',
      columns: ['questionId', 'createdAt'],
    },
    {
      name: 'ReviewRequest_status_idx',
      columns: ['status'],
    },
  ],
});
