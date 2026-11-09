import { EntitySchema } from 'typeorm';

/** AIUsage의 계정·출처·버전 연결을 저장한다. */
export interface AIUsage {
  id: string;
  ownerId: string | null;
  provider: 'naver' | 'gemini' | 'anthropic';
  task: string;
  model: string;
  sourceKey: string;
  requestId: string | null;
  status: 'running' | 'succeeded' | 'failed';
  inputTokens: number | null;
  outputTokens: number | null;
  reservedTokens: number;
  elapsedMs: number | null;
  estimatedCost: number | null;
  actualCost: number | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 생성 결과와 개인 기록의 저장 경계를 보존한다. */
export const AIUsage = new EntitySchema<AIUsage>({
  name: 'AIUsage',
  tableName: 'AIUsage',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    ownerId: {
      type: 'text',
      nullable: true,
    },
    provider: {
      type: 'text',
    },
    task: {
      type: 'text',
    },
    model: {
      type: 'text',
    },
    sourceKey: {
      type: 'text',
    },
    requestId: {
      type: 'text',
      nullable: true,
    },
    status: {
      type: 'text',
    },
    inputTokens: {
      type: 'integer',
      nullable: true,
    },
    outputTokens: {
      type: 'integer',
      nullable: true,
    },
    reservedTokens: {
      type: 'integer',
      default: 0,
    },
    elapsedMs: {
      type: 'integer',
      nullable: true,
    },
    estimatedCost: {
      type: 'double precision',
      nullable: true,
    },
    actualCost: {
      type: 'double precision',
      nullable: true,
    },
    error: {
      type: 'text',
      nullable: true,
    },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'now()',
    },
    updatedAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'now()',
      updateDate: true,
    },
  },
  foreignKeys: [
    {
      name: 'AIUsage_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  ],
  indices: [
    {
      name: 'AIUsage_ownerId_createdAt_idx',
      columns: ['ownerId', 'createdAt'],
    },
    { name: 'AIUsage_status_idx', columns: ['status'] },
  ],
  uniques: [],
});
