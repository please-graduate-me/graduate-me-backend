import { EntitySchema } from 'typeorm';
import type { User } from './User.entity.js';

/** 기존 Account 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface Account {
  id: string;
  userId: string;
  type: string;
  provider: string;
  providerAccountId: string;
  refresh_token: string | null;
  access_token: string | null;
  expires_at: number | null;
  token_type: string | null;
  scope: string | null;
  id_token: string | null;
  session_state: string | null;
  user: User;
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const Account = new EntitySchema<Account>({
  name: 'Account',
  tableName: 'Account',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => '(gen_random_uuid())',
    },
    userId: { type: 'text' },
    type: { type: 'text' },
    provider: { type: 'text' },
    providerAccountId: { type: 'text' },
    refresh_token: { type: 'text', nullable: true },
    access_token: { type: 'text', nullable: true },
    expires_at: { type: 'integer', nullable: true },
    token_type: { type: 'text', nullable: true },
    scope: { type: 'text', nullable: true },
    id_token: { type: 'text', nullable: true },
    session_state: { type: 'text', nullable: true },
  },
  relations: {
    user: {
      type: 'many-to-one',
      target: 'User',
      joinColumn: {
        name: 'userId',
        foreignKeyConstraintName: 'Account_userId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: false,
    },
  },
  indices: [
    {
      name: 'Account_provider_providerAccountId_key',
      columns: ['provider', 'providerAccountId'],
      unique: true,
    },
  ],
});
