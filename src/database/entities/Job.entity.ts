import { EntitySchema } from 'typeorm';
import type { Video } from './Video.entity.js';

/** 기존 Job 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface Job {
  id: string;
  videoId: string;
  status: string;
  attempts: number;
  availableAt: Date;
  leaseToken: string | null;
  heartbeatAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  video: Video;
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const Job = new EntitySchema<Job>({
  name: 'Job',
  tableName: 'Job',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => '(gen_random_uuid())',
    },
    videoId: { type: 'text' },
    status: { type: 'text', default: 'queued' },
    attempts: { type: 'integer', default: 0 },
    availableAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'CURRENT_TIMESTAMP',
    },
    leaseToken: { type: 'text', nullable: true },
    heartbeatAt: { type: 'timestamp', precision: 3, nullable: true },
    errorCode: { type: 'text', nullable: true },
    errorMessage: { type: 'text', nullable: true },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'CURRENT_TIMESTAMP',
    },
    updatedAt: {
      type: 'timestamp',
      precision: 3,
      updateDate: true,
      default: () => 'CURRENT_TIMESTAMP',
    },
  },
  relations: {
    video: {
      type: 'many-to-one',
      target: 'Video',
      joinColumn: {
        name: 'videoId',
        foreignKeyConstraintName: 'Job_videoId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: false,
    },
  },
  indices: [
    { name: 'Job_videoId_key', columns: ['videoId'], unique: true },
    { name: 'Job_status_availableAt_idx', columns: ['status', 'availableAt'] },
  ],
});
