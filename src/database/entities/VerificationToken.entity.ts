import { EntitySchema } from 'typeorm';

/** 기존 VerificationToken 테이블의 데이터와 관계를 타입으로 유지한다. */
export interface VerificationToken {
  identifier: string;
  token: string;
  expires: Date;
}

/** 기존 테이블과 열 이름을 유지해 저장된 데이터를 그대로 사용한다. */
export const VerificationToken = new EntitySchema<VerificationToken>({
  name: 'VerificationToken',
  tableName: 'VerificationToken',
  columns: {
    identifier: { type: 'text' },
    token: { type: 'text', primary: true },
    expires: { type: 'timestamp', precision: 3 },
  },
  relations: {},
  indices: [
    { name: 'VerificationToken_token_key', columns: ['token'], unique: true },
    {
      name: 'VerificationToken_identifier_token_key',
      columns: ['identifier', 'token'],
      unique: true,
    },
  ],
});
