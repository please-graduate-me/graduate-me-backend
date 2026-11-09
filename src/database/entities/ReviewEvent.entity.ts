import { EntitySchema } from 'typeorm';

/** 내부 운영 기록을 공개 답변과 분리하고 행위자 이름을 당시 값으로 보존한다. */
export interface ReviewEvent {
  id: string;
  questionId: string | null;
  actorId: string | null;
  actorName: string;
  action: string;
  detail: string;
  visibility: 'public' | 'internal';
  createdAt: Date;
}

/** 내부 운영 기록을 공개 답변과 분리하고 행위자 이름을 당시 값으로 보존한다. */
export const ReviewEvent = new EntitySchema<ReviewEvent>({
  name: 'ReviewEvent',
  tableName: 'ReviewEvent',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    questionId: {
      type: 'text',
      nullable: true,
    },
    actorId: {
      type: 'text',
      nullable: true,
    },
    actorName: {
      type: 'text',
    },
    action: {
      type: 'text',
    },
    detail: {
      type: 'text',
    },
    visibility: {
      type: 'text',
    },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'CURRENT_TIMESTAMP',
    },
  },
  foreignKeys: [
    {
      name: 'ReviewEvent_questionId_fkey',
      target: 'LearningQuestion',
      columnNames: ['questionId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    {
      name: 'ReviewEvent_actorId_fkey',
      target: 'User',
      columnNames: ['actorId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  ],
  indices: [
    {
      name: 'ReviewEvent_questionId_createdAt_idx',
      columns: ['questionId', 'createdAt'],
    },
  ],
});
