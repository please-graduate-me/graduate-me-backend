import { EntitySchema } from 'typeorm';

/** AIMessage의 계정·출처·버전 연결을 저장한다. */
export interface AIMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'ready' | 'failed' | 'out_of_scope';
  model: string | null;
  provider: 'naver' | 'anthropic' | null;
  citations: { quote: string }[];
  uncertainty: string | null;
  contextDescription: string | null;
  requestId: string | null;
  createdAt: Date;
}

/** 생성 결과와 개인 기록의 저장 경계를 보존한다. */
export const AIMessage = new EntitySchema<AIMessage>({
  name: 'AIMessage',
  tableName: 'AIMessage',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    conversationId: {
      type: 'text',
    },
    role: {
      type: 'text',
    },
    text: {
      type: 'text',
    },
    status: {
      type: 'text',
    },
    model: {
      type: 'text',
      nullable: true,
    },
    provider: { type: 'text', nullable: true },
    citations: {
      type: 'jsonb',
      default: () => "'[]'",
    },
    uncertainty: {
      type: 'text',
      nullable: true,
    },
    contextDescription: { type: 'text', nullable: true },
    requestId: {
      type: 'text',
      nullable: true,
    },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'now()',
    },
  },
  foreignKeys: [
    {
      name: 'AIMessage_conversationId_fkey',
      target: 'AIConversation',
      columnNames: ['conversationId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  ],
  indices: [
    {
      name: 'AIMessage_conversationId_createdAt_idx',
      columns: ['conversationId', 'createdAt'],
    },
  ],
  uniques: [],
});
