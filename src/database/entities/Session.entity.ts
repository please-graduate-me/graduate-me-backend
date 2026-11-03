import { EntitySchema } from 'typeorm';
import type { User } from './User.entity.js';

/** 기존 Session 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface Session {
  id: string;
  sessionToken: string;
  userId: string;
  expires: Date;
  user: User;
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const Session = new EntitySchema<Session>({
  name: 'Session',
  tableName: 'Session',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => '(gen_random_uuid())',
    },
    sessionToken: { type: 'text' },
    userId: { type: 'text' },
    expires: { type: 'timestamp', precision: 3 },
  },
  relations: {
    user: {
      type: 'many-to-one',
      target: 'User',
      joinColumn: {
        name: 'userId',
        foreignKeyConstraintName: 'Session_userId_fkey',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      nullable: false,
    },
  },
  indices: [
    {
      name: 'Session_sessionToken_key',
      columns: ['sessionToken'],
      unique: true,
    },
  ],
});
