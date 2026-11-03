import { EntitySchema } from 'typeorm';
import type { ShareLink } from './ShareLink.entity.js';

/** 기존 ShareVisit 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface ShareVisit {
  shareId: string;
  visitId: string;
  createdAt: Date;
  share: ShareLink;
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const ShareVisit = new EntitySchema<ShareVisit>({
  name: 'ShareVisit',
  tableName: 'ShareVisit',
  columns: {
    shareId: { type: 'text', primary: true },
    visitId: { type: 'text', primary: true },
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
        foreignKeyConstraintName: 'ShareVisit_shareId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: false,
    },
  },
  indices: [{ name: 'ShareVisit_createdAt_idx', columns: ['createdAt'] }],
});
