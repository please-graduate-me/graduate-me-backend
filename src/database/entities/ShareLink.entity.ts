import { EntitySchema } from 'typeorm';
import type { Video } from './Video.entity.js';
import type { Segment } from './Segment.entity.js';
import type { User } from './User.entity.js';
import type { ShareVisit } from './ShareVisit.entity.js';
import type { ShareStart } from './ShareStart.entity.js';

/** 기존 ShareLink 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface ShareLink {
  id: string;
  videoId: string;
  segmentId: string | null;
  creatorId: string | null;
  createdAt: Date;
  revokedAt: Date | null;
  video: Video;
  segment: Segment | null;
  creator: User | null;
  visits: ShareVisit[];
  starts: ShareStart[];
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const ShareLink = new EntitySchema<ShareLink>({
  name: 'ShareLink',
  tableName: 'ShareLink',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => '(gen_random_uuid())',
    },
    videoId: { type: 'text' },
    segmentId: { type: 'text', nullable: true },
    creatorId: { type: 'text', nullable: true },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'CURRENT_TIMESTAMP',
    },
    revokedAt: { type: 'timestamp', precision: 3, nullable: true },
  },
  relations: {
    video: {
      type: 'many-to-one',
      target: 'Video',
      joinColumn: {
        name: 'videoId',
        foreignKeyConstraintName: 'ShareLink_videoId_fkey',
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
        foreignKeyConstraintName: 'ShareLink_segmentId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: true,
    },
    creator: {
      type: 'many-to-one',
      target: 'User',
      joinColumn: {
        name: 'creatorId',
        foreignKeyConstraintName: 'ShareLink_creatorId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      nullable: true,
    },
    visits: { type: 'one-to-many', target: 'ShareVisit', inverseSide: 'share' },
    starts: { type: 'one-to-many', target: 'ShareStart', inverseSide: 'share' },
  },
  indices: [
    { name: 'ShareLink_createdAt_idx', columns: ['createdAt'] },
    { name: 'ShareLink_creatorId_idx', columns: ['creatorId'] },
    { name: 'ShareLink_videoId_idx', columns: ['videoId'] },
  ],
});
