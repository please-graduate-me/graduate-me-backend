import { EntitySchema } from 'typeorm';
import type { Progress } from './Progress.entity.js';
import type { Segment } from './Segment.entity.js';

/** 기존 Attempt 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface Attempt {
  id: string;
  progressId: string;
  segmentId: string;
  mode: string;
  answer: string | string[];
  result: Record<string, unknown>;
  correct: boolean;
  createdAt: Date;
  progress: Progress;
  segment: Segment;
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const Attempt = new EntitySchema<Attempt>({
  name: 'Attempt',
  tableName: 'Attempt',
  columns: {
    id: { type: 'text', primary: true },
    progressId: { type: 'text' },
    segmentId: { type: 'text' },
    mode: { type: 'text' },
    answer: { type: 'jsonb' },
    result: { type: 'jsonb' },
    correct: { type: 'boolean' },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'CURRENT_TIMESTAMP',
    },
  },
  relations: {
    progress: {
      type: 'many-to-one',
      target: 'Progress',
      joinColumn: {
        name: 'progressId',
        foreignKeyConstraintName: 'Attempt_progressId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: false,
    },
    segment: {
      type: 'many-to-one',
      target: 'Segment',
      joinColumn: {
        name: 'segmentId',
        foreignKeyConstraintName: 'Attempt_segmentId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: false,
    },
  },
  indices: [],
});
