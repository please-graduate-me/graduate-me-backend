import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';

/** 학생 학습 자료와 admin 답변 작업의 저장 경계를 추가한다. */
export class LearningWorkspace1794222000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const tables = [
      {
        name: 'Material',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: '(gen_random_uuid())',
            isPrimary: true,
          },
          {
            name: 'ownerId',
            type: 'text',
          },
          {
            name: 'title',
            type: 'text',
          },
          {
            name: 'language',
            type: 'text',
          },
          {
            name: 'filename',
            type: 'text',
          },
          {
            name: 'content',
            type: 'bytea',
          },
          {
            name: 'pages',
            type: 'jsonb',
          },
          {
            name: 'currentPage',
            type: 'integer',
            default: 1,
          },
          {
            name: 'memo',
            type: 'text',
            default: "''",
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
        ],
        foreignKeys: [
          {
            name: 'Material_ownerId_fkey',
            columnNames: ['ownerId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            name: 'Material_ownerId_updatedAt_idx',
            columnNames: ['ownerId', 'updatedAt'],
          },
        ],
      },
      {
        name: 'Expression',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: '(gen_random_uuid())',
            isPrimary: true,
          },
          {
            name: 'ownerId',
            type: 'text',
          },
          {
            name: 'text',
            type: 'text',
          },
          {
            name: 'meaning',
            type: 'text',
            default: "''",
          },
          {
            name: 'note',
            type: 'text',
            default: "''",
          },
          {
            name: 'source',
            type: 'jsonb',
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
        ],
        foreignKeys: [
          {
            name: 'Expression_ownerId_fkey',
            columnNames: ['ownerId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            name: 'Expression_ownerId_updatedAt_idx',
            columnNames: ['ownerId', 'updatedAt'],
          },
        ],
      },
      {
        name: 'LearningQuestion',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: '(gen_random_uuid())',
            isPrimary: true,
          },
          {
            name: 'ownerId',
            type: 'text',
          },
          {
            name: 'title',
            type: 'text',
          },
          {
            name: 'body',
            type: 'text',
          },
          {
            name: 'source',
            type: 'jsonb',
          },
          {
            name: 'status',
            type: 'text',
            default: "'waiting'",
          },
          {
            name: 'assigneeId',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'draft',
            type: 'text',
            default: "''",
          },
          {
            name: 'internalNote',
            type: 'text',
            default: "''",
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
        ],
        foreignKeys: [
          {
            name: 'LearningQuestion_ownerId_fkey',
            columnNames: ['ownerId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          {
            name: 'LearningQuestion_assigneeId_fkey',
            columnNames: ['assigneeId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
        ],
        indices: [
          {
            name: 'LearningQuestion_ownerId_updatedAt_idx',
            columnNames: ['ownerId', 'updatedAt'],
          },
          {
            name: 'LearningQuestion_assigneeId_status_idx',
            columnNames: ['assigneeId', 'status'],
          },
        ],
      },
      {
        name: 'QuestionMessage',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: '(gen_random_uuid())',
            isPrimary: true,
          },
          {
            name: 'questionId',
            type: 'text',
          },
          {
            name: 'authorId',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'authorName',
            type: 'text',
          },
          {
            name: 'body',
            type: 'text',
          },
          {
            name: 'kind',
            type: 'text',
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
        ],
        foreignKeys: [
          {
            name: 'QuestionMessage_questionId_fkey',
            columnNames: ['questionId'],
            referencedTableName: 'LearningQuestion',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          {
            name: 'QuestionMessage_authorId_fkey',
            columnNames: ['authorId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
        ],
        indices: [
          {
            name: 'QuestionMessage_questionId_createdAt_idx',
            columnNames: ['questionId', 'createdAt'],
          },
        ],
      },
      {
        name: 'HelperProfile',
        columns: [
          {
            name: 'userId',
            type: 'text',
            isPrimary: true,
          },
          {
            name: 'languages',
            type: 'jsonb',
          },
          {
            name: 'materialIds',
            type: 'jsonb',
          },
          {
            name: 'canReview',
            type: 'boolean',
            default: false,
          },
          {
            name: 'canRequestEdit',
            type: 'boolean',
            default: false,
          },
          {
            name: 'active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
        ],
        foreignKeys: [
          {
            name: 'HelperProfile_userId_fkey',
            columnNames: ['userId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        ],
        indices: [],
      },
      {
        name: 'ReviewRequest',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: '(gen_random_uuid())',
            isPrimary: true,
          },
          {
            name: 'questionId',
            type: 'text',
          },
          {
            name: 'authorId',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'authorName',
            type: 'text',
          },
          {
            name: 'scope',
            type: 'text',
          },
          {
            name: 'version',
            type: 'text',
          },
          {
            name: 'reason',
            type: 'text',
          },
          {
            name: 'source',
            type: 'jsonb',
          },
          {
            name: 'status',
            type: 'text',
            default: "'open'",
          },
          {
            name: 'resolution',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
        ],
        foreignKeys: [
          {
            name: 'ReviewRequest_questionId_fkey',
            columnNames: ['questionId'],
            referencedTableName: 'LearningQuestion',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          {
            name: 'ReviewRequest_authorId_fkey',
            columnNames: ['authorId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
        ],
        indices: [
          {
            name: 'ReviewRequest_questionId_createdAt_idx',
            columnNames: ['questionId', 'createdAt'],
          },
          {
            name: 'ReviewRequest_status_idx',
            columnNames: ['status'],
          },
        ],
      },
      {
        name: 'ReviewEvent',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: '(gen_random_uuid())',
            isPrimary: true,
          },
          {
            name: 'questionId',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'actorId',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'actorName',
            type: 'text',
          },
          {
            name: 'action',
            type: 'text',
          },
          {
            name: 'detail',
            type: 'text',
          },
          {
            name: 'visibility',
            type: 'text',
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
        ],
        foreignKeys: [
          {
            name: 'ReviewEvent_questionId_fkey',
            columnNames: ['questionId'],
            referencedTableName: 'LearningQuestion',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          {
            name: 'ReviewEvent_actorId_fkey',
            columnNames: ['actorId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
        ],
        indices: [
          {
            name: 'ReviewEvent_questionId_createdAt_idx',
            columnNames: ['questionId', 'createdAt'],
          },
        ],
      },
      {
        name: 'PracticeAttempt',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: '(gen_random_uuid())',
            isPrimary: true,
          },
          {
            name: 'ownerId',
            type: 'text',
          },
          {
            name: 'expressionId',
            type: 'text',
          },
          {
            name: 'answer',
            type: 'text',
          },
          {
            name: 'correct',
            type: 'boolean',
          },
          {
            name: 'mode',
            type: 'text',
            default: "'self'",
          },
          {
            name: 'snapshot',
            type: 'jsonb',
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
        ],
        foreignKeys: [
          {
            name: 'PracticeAttempt_ownerId_fkey',
            columnNames: ['ownerId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            name: 'PracticeAttempt_ownerId_createdAt_idx',
            columnNames: ['ownerId', 'createdAt'],
          },
        ],
      },
    ];

    for (const table of tables) await runner.createTable(new Table(table));
  }
  async down(): Promise<void> {
    throw new Error(
      '저장된 질문과 학습 기록 보호를 위해 후속 마이그레이션으로 변경해 주세요.'
    );
  }
}
