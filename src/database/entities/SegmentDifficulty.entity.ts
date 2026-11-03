import { EntitySchema } from 'typeorm';
import type { Progress } from './Progress.entity.js';
import type { Segment } from './Segment.entity.js';

/** 기존 SegmentDifficulty 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface SegmentDifficulty {
  progressId: string;
  segmentId: string;
  createdAt: Date;
  progress: Progress;
  segment: Segment;
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const SegmentDifficulty = new EntitySchema<SegmentDifficulty>({
  name: 'SegmentDifficulty',
  tableName: 'SegmentDifficulty',
  columns: {
    progressId: { type: 'text', primary: true },
    segmentId: { type: 'text', primary: true },
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
        foreignKeyConstraintName: 'SegmentDifficulty_progressId_fkey',
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
        foreignKeyConstraintName: 'SegmentDifficulty_segmentId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: false,
    },
  },
  indices: [],
});
