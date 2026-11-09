import { EntitySchema } from 'typeorm';
import type { LearningSource } from '../../learning/contracts.js';

/** ExerciseAttempt의 계정·출처·버전 연결을 저장한다. */
export interface ExerciseAttempt {
  id: string;
  ownerId: string;
  artifactId: string;
  version: number;
  answer: string;
  correct: boolean | null;
  expectedAnswer: string;
  explanation: string;
  feedback: string | null;
  source: LearningSource;
  questionPayload: Record<string, unknown>;
  hintUsed: boolean;
  revealed: boolean;
  createdAt: Date;
}

/** 생성 결과와 개인 기록의 저장 경계를 보존한다. */
export const ExerciseAttempt = new EntitySchema<ExerciseAttempt>({
  name: 'ExerciseAttempt',
  tableName: 'ExerciseAttempt',
  columns: {
    id: {
      type: 'text',
      primary: true,
    },
    ownerId: {
      type: 'text',
    },
    artifactId: {
      type: 'text',
    },
    version: {
      type: 'integer',
    },
    answer: {
      type: 'text',
    },
    correct: {
      type: 'boolean',
      nullable: true,
    },
    expectedAnswer: {
      type: 'text',
    },
    explanation: {
      type: 'text',
    },
    feedback: {
      type: 'text',
      nullable: true,
    },
    source: {
      type: 'jsonb',
    },
    questionPayload: {
      type: 'jsonb',
    },
    hintUsed: {
      type: 'boolean',
    },
    revealed: {
      type: 'boolean',
    },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'now()',
    },
  },
  foreignKeys: [
    {
      name: 'ExerciseAttempt_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    {
      name: 'ExerciseAttempt_artifactId_fkey',
      target: 'LearningArtifact',
      columnNames: ['artifactId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  ],
  indices: [
    {
      name: 'ExerciseAttempt_ownerId_createdAt_idx',
      columns: ['ownerId', 'createdAt'],
    },
    {
      name: 'ExerciseAttempt_artifactId_version_idx',
      columns: ['artifactId', 'version'],
    },
  ],
  uniques: [],
});
