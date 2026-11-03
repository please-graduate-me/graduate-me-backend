import { EntitySchema } from 'typeorm';
import type { ShareLink } from './ShareLink.entity.js';
import type { User } from './User.entity.js';

/** 기존 ShareStart 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface ShareStart {
  id: string;
  shareId: string;
  userId: string | null;
  createdAt: Date;
  share: ShareLink;
  user: User | null;
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const ShareStart = new EntitySchema<ShareStart>({
  name: 'ShareStart',
  tableName: 'ShareStart',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => '(gen_random_uuid())',
    },
    shareId: { type: 'text' },
    userId: { type: 'text', nullable: true },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'CURRENT_TIMESTAMP',
    },
  },
  relations: {
    share: {
      type: 'many-to-one',
      target: 'ShareLink',
      joinColumn: {
        name: 'shareId',
        foreignKeyConstraintName: 'ShareStart_shareId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: false,
    },
    user: {
      type: 'many-to-one',
      target: 'User',
      joinColumn: {
        name: 'userId',
        foreignKeyConstraintName: 'ShareStart_userId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      nullable: true,
    },
  },
  indices: [
    {
      name: 'ShareStart_shareId_userId_key',
      columns: ['shareId', 'userId'],
      unique: true,
    },
    { name: 'ShareStart_createdAt_idx', columns: ['createdAt'] },
  ],
});
