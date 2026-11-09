import { EntitySchema } from 'typeorm';
import type { User } from './User.entity.js';
import type { Video } from './Video.entity.js';
import type { SegmentState } from './SegmentState.entity.js';
import type { Attempt } from './Attempt.entity.js';
import type { SegmentDifficulty } from './SegmentDifficulty.entity.js';

/** 기존 Progress 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface Progress {
  id: string;
  userId: string;
  videoId: string;
  currentIndex: number;
  mode: string;
  blankRatio: 20 | 40 | 60;
  cycle: number;
  scriptViewed: boolean;
  favorite: boolean;
  archivedAt: Date | null;
  updatedAt: Date;
  user: User;
  video: Video;
  states: SegmentState[];
  attempts: Attempt[];
  difficulties: SegmentDifficulty[];
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const Progress = new EntitySchema<Progress>({
  name: 'Progress',
  tableName: 'Progress',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => '(gen_random_uuid())',
    },
    userId: { type: 'text' },
    videoId: { type: 'text' },
    currentIndex: { type: 'integer', default: 0 },
    mode: { type: 'text', default: 'blank' },
    blankRatio: { type: 'integer', default: 20 },
    cycle: { type: 'integer', default: 0 },
    scriptViewed: { type: 'boolean', default: false },
    favorite: { type: 'boolean', default: false },
    archivedAt: { type: 'timestamp', precision: 3, nullable: true },
    updatedAt: {
      type: 'timestamp',
      precision: 3,
      updateDate: true,
      default: () => 'CURRENT_TIMESTAMP',
    },
  },
  relations: {
    user: {
      type: 'many-to-one',
      target: 'User',
      joinColumn: {
        name: 'userId',
        foreignKeyConstraintName: 'Progress_userId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: false,
    },
    video: {
      type: 'many-to-one',
      target: 'Video',
      joinColumn: {
        name: 'videoId',
        foreignKeyConstraintName: 'Progress_videoId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: false,
    },
    states: {
      type: 'one-to-many',
      target: 'SegmentState',
      inverseSide: 'progress',
    },
    attempts: {
      type: 'one-to-many',
      target: 'Attempt',
      inverseSide: 'progress',
    },
    difficulties: {
      type: 'one-to-many',
      target: 'SegmentDifficulty',
      inverseSide: 'progress',
    },
  },
  indices: [
    {
      name: 'Progress_userId_videoId_key',
      columns: ['userId', 'videoId'],
      unique: true,
    },
  ],
});
