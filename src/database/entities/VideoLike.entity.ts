import { EntitySchema } from 'typeorm';
import type { User } from './User.entity.js';
import type { Video } from './Video.entity.js';

/** 기존 VideoLike 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface VideoLike {
  userId: string;
  videoId: string;
  createdAt: Date;
  user: User;
  video: Video;
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const VideoLike = new EntitySchema<VideoLike>({
  name: 'VideoLike',
  tableName: 'VideoLike',
  columns: {
    userId: { type: 'text', primary: true },
    videoId: { type: 'text', primary: true },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'CURRENT_TIMESTAMP',
    },
  },
  relations: {
    user: {
      type: 'many-to-one',
      target: 'User',
      joinColumn: {
        name: 'userId',
        foreignKeyConstraintName: 'VideoLike_userId_fkey',
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
        foreignKeyConstraintName: 'VideoLike_videoId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: false,
    },
  },
  indices: [{ name: 'VideoLike_videoId_idx', columns: ['videoId'] }],
});
