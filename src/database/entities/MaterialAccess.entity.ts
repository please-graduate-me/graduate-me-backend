import { EntitySchema } from 'typeorm';

/** MaterialAccess의 계정·출처·버전 연결을 저장한다. */
export interface MaterialAccess {
  id: string;
  kind: 'pdf' | 'video';
  visibility: 'private' | 'public' | 'accounts';
  allowedUserIds: string[];
  version: number;
  updatedAt: Date;
}

/** 생성 결과와 개인 기록의 저장 경계를 보존한다. */
export const MaterialAccess = new EntitySchema<MaterialAccess>({
  name: 'MaterialAccess',
  tableName: 'MaterialAccess',
  columns: {
    id: {
      type: 'text',
      primary: true,
    },
    kind: {
      type: 'text',
      primary: true,
    },
    visibility: {
      type: 'text',
    },
    allowedUserIds: {
      type: 'jsonb',
    },
    version: {
      type: 'integer',
      default: 1,
    },
    updatedAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'now()',
      updateDate: true,
    },
  },
  foreignKeys: [],
  indices: [],
  uniques: [],
});
