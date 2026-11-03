import { EntitySchema } from 'typeorm';
import type { Progress } from './Progress.entity.js';
import type { Segment } from './Segment.entity.js';

/** 기존 SegmentState 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface SegmentState {
  id: string;
  progressId: string;
  segmentId: string;
  mode: string;
  draft: string | string[];
  status: string;
  revealed: boolean;
  updatedAt: Date;
  progress: Progress;
  segment: Segment;
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const SegmentState = new EntitySchema<SegmentState>({
  name: 'SegmentState',
  tableName: 'SegmentState',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => '(gen_random_uuid())',
    },
    progressId: { type: 'text' },
    segmentId: { type: 'text' },
    mode: { type: 'text' },
    draft: { type: 'jsonb' },
    status: { type: 'text', default: 'pending' },
    revealed: { type: 'boolean', default: false },
    updatedAt: {
      type: 'timestamp',
      precision: 3,
      updateDate: true,
      default: () => 'CURRENT_TIMESTAMP',
    },
  },
  relations: {
    progress: {
      type: 'many-to-one',
      target: 'Progress',
      joinColumn: {
        name: 'progressId',
        foreignKeyConstraintName: 'SegmentState_progressId_fkey',
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
        foreignKeyConstraintName: 'SegmentState_segmentId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: false,
    },
  },
  indices: [
    {
      name: 'SegmentState_progressId_segmentId_mode_key',
      columns: ['progressId', 'segmentId', 'mode'],
      unique: true,
    },
  ],
});
