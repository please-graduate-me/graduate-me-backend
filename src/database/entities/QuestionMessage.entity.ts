import { EntitySchema } from 'typeorm';

/** 학생에게 게시된 질문과 답변만 별도 행으로 저장한다. */
export interface QuestionMessage {
  id: string;
  questionId: string;
  authorId: string | null;
  authorName: string;
  body: string;
  kind: 'question' | 'answer';
  createdAt: Date;
}

/** 학생에게 게시된 질문과 답변만 별도 행으로 저장한다. */
export const QuestionMessage = new EntitySchema<QuestionMessage>({
  name: 'QuestionMessage',
  tableName: 'QuestionMessage',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    questionId: {
      type: 'text',
    },
    authorId: {
      type: 'text',
      nullable: true,
    },
    authorName: {
      type: 'text',
    },
    body: {
      type: 'text',
    },
    kind: {
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
      name: 'QuestionMessage_questionId_fkey',
      target: 'LearningQuestion',
      columnNames: ['questionId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    {
      name: 'QuestionMessage_authorId_fkey',
      target: 'User',
      columnNames: ['authorId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  ],
  indices: [
    {
      name: 'QuestionMessage_questionId_createdAt_idx',
      columns: ['questionId', 'createdAt'],
    },
  ],
});
