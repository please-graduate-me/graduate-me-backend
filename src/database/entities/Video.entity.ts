import { EntitySchema } from 'typeorm';
import type { Job } from './Job.entity.js';
import type { Segment } from './Segment.entity.js';
import type { Progress } from './Progress.entity.js';
import type { VideoLike } from './VideoLike.entity.js';
import type { ShareLink } from './ShareLink.entity.js';

/** 기존 Video 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface Video {
  id: string;
  youtubeId: string;
  title: string;
  duration: number | null;
  category: string | null;
  youtubeCategoryId: string | null;
  createdAt: Date;
  job: Job | null;
  segments: Segment[];
  progress: Progress[];
  likes: VideoLike[];
  shareLinks: ShareLink[];
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const Video = new EntitySchema<Video>({
  name: 'Video',
  tableName: 'Video',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => '(gen_random_uuid())',
    },
    youtubeId: { type: 'text' },
    title: { type: 'text' },
    duration: { type: 'double precision', nullable: true },
    category: { type: 'text', nullable: true },
    youtubeCategoryId: { type: 'text', nullable: true },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'CURRENT_TIMESTAMP',
    },
  },
  relations: {
    job: { type: 'one-to-one', target: 'Job', inverseSide: 'video' },
    segments: { type: 'one-to-many', target: 'Segment', inverseSide: 'video' },
    progress: { type: 'one-to-many', target: 'Progress', inverseSide: 'video' },
    likes: { type: 'one-to-many', target: 'VideoLike', inverseSide: 'video' },
    shareLinks: {
      type: 'one-to-many',
      target: 'ShareLink',
      inverseSide: 'video',
    },
  },
  indices: [
    { name: 'Video_youtubeId_key', columns: ['youtubeId'], unique: true },
  ],
});
