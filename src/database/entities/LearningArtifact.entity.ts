import { EntitySchema } from 'typeorm';
import type { LearningSource } from '../../learning/contracts.js';

/** LearningArtifact의 계정·출처·버전 연결을 저장한다. */
export interface LearningArtifact {
  id: string;
  ownerId: string;
  kind: 'explanation' | 'practice';
  source: LearningSource;
  version: number;
  status: 'ready' | 'suspended';
  reviewStatus: 'unreviewed' | 'verified' | 'needs_review';
  needsReview: boolean;
  model: string;
  provider: string;
  cacheKey: string | null;
  expressionIds: string[];
  parentIds: string[];
  batchId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 생성 결과와 개인 기록의 저장 경계를 보존한다. */
export const LearningArtifact = new EntitySchema<LearningArtifact>({
  name: 'LearningArtifact',
  tableName: 'LearningArtifact',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    ownerId: {
      type: 'text',
    },
    kind: {
      type: 'text',
    },
    source: {
      type: 'jsonb',
    },
    version: {
      type: 'integer',
      default: 1,
    },
    status: {
      type: 'text',
      default: () => "'ready'",
    },
    reviewStatus: {
      type: 'text',
      default: () => "'unreviewed'",
    },
    needsReview: {
      type: 'boolean',
      default: false,
    },
    model: {
      type: 'text',
    },
    provider: {
      type: 'text',
    },
    cacheKey: {
      type: 'text',
      nullable: true,
    },
    expressionIds: {
      type: 'jsonb',
      default: () => "'[]'",
    },
    parentIds: {
      type: 'jsonb',
      default: () => "'[]'",
    },
    batchId: {
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
      name: 'LearningArtifact_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  ],
  indices: [
    {
      name: 'LearningArtifact_ownerId_kind_updatedAt_idx',
      columns: ['ownerId', 'kind', 'updatedAt'],
    },
  ],
  uniques: [
    {
      name: 'LearningArtifact_ownerId_cacheKey_key',
      columns: ['ownerId', 'cacheKey'],
    },
  ],
});
