import { EntitySchema } from 'typeorm';

/** 운영자가 부여한 도우미의 언어·자료·검토 권한을 명시적으로 저장한다. */
export interface HelperProfile {
  userId: string;
  languages: ('en' | 'th')[];
  materialIds: string[];
  canReview: boolean;
  canRequestEdit: boolean;
  active: boolean;
  updatedAt: Date;
}

/** 운영자가 부여한 도우미의 언어·자료·검토 권한을 명시적으로 저장한다. */
export const HelperProfile = new EntitySchema<HelperProfile>({
  name: 'HelperProfile',
  tableName: 'HelperProfile',
  columns: {
    userId: {
      type: 'text',
      primary: true,
    },
    languages: {
      type: 'jsonb',
    },
    materialIds: {
      type: 'jsonb',
    },
    canReview: {
      type: 'boolean',
      default: false,
    },
    canRequestEdit: {
      type: 'boolean',
      default: false,
    },
    active: {
      type: 'boolean',
      default: true,
    },
    updatedAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'CURRENT_TIMESTAMP',
      updateDate: true,
    },
  },
  foreignKeys: [
    {
      name: 'HelperProfile_userId_fkey',
      target: 'User',
      columnNames: ['userId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  ],
  indices: [],
});
