import { EntitySchema } from 'typeorm';
import type { Account } from './Account.entity.js';
import type { Session } from './Session.entity.js';
import type { Progress } from './Progress.entity.js';
import type { VideoLike } from './VideoLike.entity.js';
import type { ShareLink } from './ShareLink.entity.js';
import type { ShareStart } from './ShareStart.entity.js';

/** 기존 User 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface User {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: Date | null;
  autoReplay: boolean;
  replayDelay: number;
  replayCount: number | null;
  playbackRate: number;
  image: string | null;
  accounts: Account[];
  sessions: Session[];
  progress: Progress[];
  videoLikes: VideoLike[];
  sharedLinks: ShareLink[];
  shareStarts: ShareStart[];
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const User = new EntitySchema<User>({
  name: 'User',
  tableName: 'User',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => '(gen_random_uuid())',
    },
    name: { type: 'text', nullable: true },
    email: { type: 'text', nullable: true },
    emailVerified: { type: 'timestamp', precision: 3, nullable: true },
    autoReplay: { type: 'boolean', default: false },
    replayDelay: { type: 'integer', default: 1 },
    replayCount: { type: 'integer', nullable: true },
    playbackRate: { type: 'double precision', default: 1 },
    image: { type: 'text', nullable: true },
  },
  relations: {
    accounts: { type: 'one-to-many', target: 'Account', inverseSide: 'user' },
    sessions: { type: 'one-to-many', target: 'Session', inverseSide: 'user' },
    progress: { type: 'one-to-many', target: 'Progress', inverseSide: 'user' },
    videoLikes: {
      type: 'one-to-many',
      target: 'VideoLike',
      inverseSide: 'user',
    },
    sharedLinks: {
      type: 'one-to-many',
      target: 'ShareLink',
      inverseSide: 'creator',
    },
    shareStarts: {
      type: 'one-to-many',
      target: 'ShareStart',
      inverseSide: 'user',
    },
  },
  indices: [{ name: 'User_email_key', columns: ['email'], unique: true }],
});
