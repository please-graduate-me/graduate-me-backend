import { EntitySchema } from 'typeorm';
import type { Video } from './Video.entity.js';
import type { SegmentState } from './SegmentState.entity.js';
import type { Attempt } from './Attempt.entity.js';
import type { SegmentDifficulty } from './SegmentDifficulty.entity.js';
import type { ShareLink } from './ShareLink.entity.js';

/** 기존 Segment 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface Segment {
  id: string;
  videoId: string;
  index: number;
  start: number;
  end: number;
  text: string;
  words: { word: string; start: number; end: number }[];
  excluded: boolean;
  exclusionReason: string | null;
  video: Video;
  states: SegmentState[];
  attempts: Attempt[];
  difficulties: SegmentDifficulty[];
  shareLinks: ShareLink[];
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const Segment = new EntitySchema<Segment>({
  name: 'Segment',
  tableName: 'Segment',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => '(gen_random_uuid())',
    },
    videoId: { type: 'text' },
    index: { type: 'integer' },
    start: { type: 'double precision' },
    end: { type: 'double precision' },
    text: { type: 'text' },
    words: { type: 'jsonb' },
    excluded: { type: 'boolean', default: false },
    exclusionReason: { type: 'text', nullable: true },
  },
  relations: {
    video: {
      type: 'many-to-one',
      target: 'Video',
      joinColumn: {
        name: 'videoId',
        foreignKeyConstraintName: 'Segment_videoId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: false,
    },
    states: {
      type: 'one-to-many',
      target: 'SegmentState',
      inverseSide: 'segment',
    },
    attempts: {
      type: 'one-to-many',
      target: 'Attempt',
      inverseSide: 'segment',
    },
    difficulties: {
      type: 'one-to-many',
      target: 'SegmentDifficulty',
      inverseSide: 'segment',
    },
    shareLinks: {
      type: 'one-to-many',
      target: 'ShareLink',
      inverseSide: 'segment',
    },
  },
  indices: [
    {
      name: 'Segment_videoId_index_key',
      columns: ['videoId', 'index'],
      unique: true,
    },
  ],
});
