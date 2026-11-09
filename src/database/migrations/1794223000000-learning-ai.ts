import {
  Table,
  TableColumn,
  type MigrationInterface,
  type QueryRunner,
} from 'typeorm';

/** 원문 AI 결과·변경 버전·개인 대화와 실제 연습·사용량을 저장한다. */
export class LearningAI1794223000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const columns: [string, ConstructorParameters<typeof TableColumn>[0]][] = [
      [
        'User',
        {
          name: 'targetLanguage',
          type: 'text',
          default: "'en'",
        },
      ],
      [
        'User',
        {
          name: 'explanationLanguage',
          type: 'text',
          default: "'ko'",
        },
      ],
      [
        'User',
        {
          name: 'level',
          type: 'text',
          default: "'beginner'",
        },
      ],
      [
        'User',
        {
          name: 'interests',
          type: 'jsonb',
          default: "'[]'::jsonb",
        },
      ],
      [
        'Material',
        {
          name: 'version',
          type: 'integer',
          default: 1,
        },
      ],
      [
        'Expression',
        {
          name: 'kind',
          type: 'text',
          default: "'phrase'",
        },
      ],
      [
        'Expression',
        {
          name: 'reviewIncluded',
          type: 'boolean',
          default: true,
        },
      ],
      [
        'Expression',
        {
          name: 'explanationId',
          type: 'text',
          isNullable: true,
        },
      ],
      [
        'Expression',
        {
          name: 'explanationVersion',
          type: 'integer',
          isNullable: true,
        },
      ],
      [
        'LearningQuestion',
        {
          name: 'kind',
          type: 'text',
          default: "'question'",
        },
      ],
      [
        'LearningQuestion',
        {
          name: 'resolvedAt',
          type: 'timestamp',
          precision: 3,
          isNullable: true,
        },
      ],
      [
        'LearningQuestion',
        {
          name: 'revokedAt',
          type: 'timestamp',
          precision: 3,
          isNullable: true,
        },
      ],
      [
        'LearningQuestion',
        {
          name: 'attachment',
          type: 'jsonb',
          isNullable: true,
        },
      ],
      [
        'HelperProfile',
        {
          name: 'canEdit',
          type: 'boolean',
          default: false,
        },
      ],
      [
        'ReviewRequest',
        {
          name: 'target',
          type: 'jsonb',
          isNullable: true,
        },
      ],
      [
        'ReviewRequest',
        {
          name: 'kind',
          type: 'text',
          default: "'review_request'",
        },
      ],
    ];

    for (const [table, column] of columns)
      await runner.addColumn(table, new TableColumn(column));

    const tables = [
      {
        name: 'LearningArtifact',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: 'gen_random_uuid()',
            isPrimary: true,
          },
          {
            name: 'ownerId',
            type: 'text',
          },
          {
            name: 'kind',
            type: 'text',
          },
          {
            name: 'source',
            type: 'jsonb',
          },
          {
            name: 'version',
            type: 'integer',
            default: 1,
          },
          {
            name: 'status',
            type: 'text',
            default: "'ready'",
          },
          {
            name: 'reviewStatus',
            type: 'text',
            default: "'unreviewed'",
          },
          {
            name: 'needsReview',
            type: 'boolean',
            default: false,
          },
          {
            name: 'model',
            type: 'text',
          },
          {
            name: 'provider',
            type: 'text',
          },
          {
            name: 'cacheKey',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'expressionIds',
            type: 'jsonb',
            default: "'[]'::jsonb",
          },
          {
            name: 'parentIds',
            type: 'jsonb',
            default: "'[]'::jsonb",
          },
          {
            name: 'batchId',
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
            name: 'LearningArtifact_ownerId_fkey',
            columnNames: ['ownerId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            name: 'LearningArtifact_ownerId_kind_updatedAt_idx',
            columnNames: ['ownerId', 'kind', 'updatedAt'],
          },
        ],
        uniques: [
          {
            name: 'LearningArtifact_ownerId_cacheKey_key',
            columnNames: ['ownerId', 'cacheKey'],
          },
        ],
      },
      {
        name: 'ArtifactRevision',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: 'gen_random_uuid()',
            isPrimary: true,
          },
          {
            name: 'artifactId',
            type: 'text',
          },
          {
            name: 'version',
            type: 'integer',
          },
          {
            name: 'payload',
            type: 'jsonb',
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
            name: 'reason',
            type: 'text',
          },
          {
            name: 'reviewStatus',
            type: 'text',
            default: "'unreviewed'",
          },
          {
            name: 'status',
            type: 'text',
            default: "'ready'",
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
            name: 'ArtifactRevision_artifactId_fkey',
            columnNames: ['artifactId'],
            referencedTableName: 'LearningArtifact',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          {
            name: 'ArtifactRevision_actorId_fkey',
            columnNames: ['actorId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
        ],
        indices: [],
        uniques: [
          {
            name: 'ArtifactRevision_artifactId_version_key',
            columnNames: ['artifactId', 'version'],
          },
        ],
      },
      {
        name: 'AIOperation',
        columns: [
          {
            name: 'id',
            type: 'text',
            isPrimary: true,
          },
          {
            name: 'ownerId',
            type: 'text',
          },
          {
            name: 'task',
            type: 'text',
          },
          {
            name: 'fingerprint',
            type: 'text',
          },
          {
            name: 'status',
            type: 'text',
          },
          {
            name: 'result',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'error',
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
            name: 'AIOperation_ownerId_fkey',
            columnNames: ['ownerId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            name: 'AIOperation_ownerId_createdAt_idx',
            columnNames: ['ownerId', 'createdAt'],
          },
        ],
        uniques: [],
      },
      {
        name: 'AIUsage',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: 'gen_random_uuid()',
            isPrimary: true,
          },
          {
            name: 'ownerId',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'provider',
            type: 'text',
          },
          {
            name: 'task',
            type: 'text',
          },
          {
            name: 'model',
            type: 'text',
          },
          {
            name: 'sourceKey',
            type: 'text',
          },
          {
            name: 'requestId',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'text',
          },
          {
            name: 'inputTokens',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'outputTokens',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'reservedTokens',
            type: 'integer',
            default: 0,
          },
          {
            name: 'elapsedMs',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'estimatedCost',
            type: 'double precision',
            isNullable: true,
          },
          {
            name: 'actualCost',
            type: 'double precision',
            isNullable: true,
          },
          {
            name: 'error',
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
            name: 'AIUsage_ownerId_fkey',
            columnNames: ['ownerId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
        ],
        indices: [
          {
            name: 'AIUsage_ownerId_createdAt_idx',
            columnNames: ['ownerId', 'createdAt'],
          },
          {
            name: 'AIUsage_status_idx',
            columnNames: ['status'],
          },
        ],
        uniques: [],
      },
      {
        name: 'AIConversation',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: 'gen_random_uuid()',
            isPrimary: true,
          },
          {
            name: 'ownerId',
            type: 'text',
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
            name: 'AIConversation_ownerId_fkey',
            columnNames: ['ownerId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            name: 'AIConversation_ownerId_updatedAt_idx',
            columnNames: ['ownerId', 'updatedAt'],
          },
        ],
        uniques: [],
      },
      {
        name: 'AIMessage',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: 'gen_random_uuid()',
            isPrimary: true,
          },
          {
            name: 'conversationId',
            type: 'text',
          },
          {
            name: 'role',
            type: 'text',
          },
          {
            name: 'text',
            type: 'text',
          },
          {
            name: 'status',
            type: 'text',
          },
          {
            name: 'model',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'citations',
            type: 'jsonb',
            default: "'[]'::jsonb",
          },
          {
            name: 'uncertainty',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'requestId',
            type: 'text',
            isNullable: true,
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
            name: 'AIMessage_conversationId_fkey',
            columnNames: ['conversationId'],
            referencedTableName: 'AIConversation',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            name: 'AIMessage_conversationId_createdAt_idx',
            columnNames: ['conversationId', 'createdAt'],
          },
        ],
        uniques: [],
      },
      {
        name: 'ExerciseAttempt',
        columns: [
          {
            name: 'id',
            type: 'text',
            isPrimary: true,
          },
          {
            name: 'ownerId',
            type: 'text',
          },
          {
            name: 'artifactId',
            type: 'text',
          },
          {
            name: 'version',
            type: 'integer',
          },
          {
            name: 'answer',
            type: 'text',
          },
          {
            name: 'correct',
            type: 'boolean',
            isNullable: true,
          },
          {
            name: 'expectedAnswer',
            type: 'text',
          },
          {
            name: 'explanation',
            type: 'text',
          },
          {
            name: 'feedback',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'source',
            type: 'jsonb',
          },
          {
            name: 'questionPayload',
            type: 'jsonb',
          },
          {
            name: 'hintUsed',
            type: 'boolean',
          },
          {
            name: 'revealed',
            type: 'boolean',
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
            name: 'ExerciseAttempt_ownerId_fkey',
            columnNames: ['ownerId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          {
            name: 'ExerciseAttempt_artifactId_fkey',
            columnNames: ['artifactId'],
            referencedTableName: 'LearningArtifact',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            name: 'ExerciseAttempt_ownerId_createdAt_idx',
            columnNames: ['ownerId', 'createdAt'],
          },
          {
            name: 'ExerciseAttempt_artifactId_version_idx',
            columnNames: ['artifactId', 'version'],
          },
        ],
        uniques: [],
      },
      {
        name: 'ExerciseState',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: 'gen_random_uuid()',
            isPrimary: true,
          },
          {
            name: 'ownerId',
            type: 'text',
          },
          {
            name: 'artifactId',
            type: 'text',
          },
          {
            name: 'version',
            type: 'integer',
          },
          {
            name: 'draft',
            type: 'text',
            default: "''",
          },
          {
            name: 'hintUsed',
            type: 'boolean',
            default: false,
          },
          {
            name: 'revealed',
            type: 'boolean',
            default: false,
          },
          {
            name: 'excluded',
            type: 'boolean',
            default: false,
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
            name: 'ExerciseState_ownerId_fkey',
            columnNames: ['ownerId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          {
            name: 'ExerciseState_artifactId_fkey',
            columnNames: ['artifactId'],
            referencedTableName: 'LearningArtifact',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        ],
        indices: [],
        uniques: [
          {
            name: 'ExerciseState_ownerId_artifactId_version_key',
            columnNames: ['ownerId', 'artifactId', 'version'],
          },
        ],
      },
      {
        name: 'Annotation',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: 'gen_random_uuid()',
            isPrimary: true,
          },
          {
            name: 'ownerId',
            type: 'text',
          },
          {
            name: 'source',
            type: 'jsonb',
          },
          {
            name: 'color',
            type: 'text',
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
            name: 'Annotation_ownerId_fkey',
            columnNames: ['ownerId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            name: 'Annotation_ownerId_updatedAt_idx',
            columnNames: ['ownerId', 'updatedAt'],
          },
        ],
        uniques: [],
      },
      {
        name: 'ExcerptShare',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: 'gen_random_uuid()',
            isPrimary: true,
          },
          {
            name: 'ownerId',
            type: 'text',
          },
          {
            name: 'source',
            type: 'jsonb',
          },
          {
            name: 'visibility',
            type: 'text',
          },
          {
            name: 'allowedUserIds',
            type: 'jsonb',
          },
          {
            name: 'revokedAt',
            type: 'timestamp',
            precision: 3,
            isNullable: true,
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
            name: 'ExcerptShare_ownerId_fkey',
            columnNames: ['ownerId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            name: 'ExcerptShare_ownerId_createdAt_idx',
            columnNames: ['ownerId', 'createdAt'],
          },
        ],
        uniques: [],
      },
      {
        name: 'MaterialAccess',
        columns: [
          {
            name: 'id',
            type: 'text',
            isPrimary: true,
          },
          {
            name: 'kind',
            type: 'text',
            isPrimary: true,
          },
          {
            name: 'visibility',
            type: 'text',
          },
          {
            name: 'allowedUserIds',
            type: 'jsonb',
          },
          {
            name: 'version',
            type: 'integer',
            default: 1,
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
        ],
        foreignKeys: [],
        indices: [],
        uniques: [],
      },
      {
        name: 'MaterialReading',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: 'gen_random_uuid()',
            isPrimary: true,
          },
          {
            name: 'ownerId',
            type: 'text',
          },
          {
            name: 'materialId',
            type: 'text',
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
            name: 'updatedAt',
            type: 'timestamp',
            precision: 3,
            default: 'now()',
          },
        ],
        foreignKeys: [
          {
            name: 'MaterialReading_ownerId_fkey',
            columnNames: ['ownerId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          {
            name: 'MaterialReading_materialId_fkey',
            columnNames: ['materialId'],
            referencedTableName: 'Material',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        ],
        indices: [],
        uniques: [
          {
            name: 'MaterialReading_ownerId_materialId_key',
            columnNames: ['ownerId', 'materialId'],
          },
        ],
      },
      {
        name: 'SourceRevision',
        columns: [
          {
            name: 'id',
            type: 'text',
            default: 'gen_random_uuid()',
            isPrimary: true,
          },
          {
            name: 'segmentId',
            type: 'text',
          },
          {
            name: 'version',
            type: 'integer',
          },
          {
            name: 'payload',
            type: 'jsonb',
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
            name: 'reason',
            type: 'text',
          },
          {
            name: 'reviewStatus',
            type: 'text',
            default: "'unreviewed'",
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
            name: 'SourceRevision_segmentId_fkey',
            columnNames: ['segmentId'],
            referencedTableName: 'Segment',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          {
            name: 'SourceRevision_actorId_fkey',
            columnNames: ['actorId'],
            referencedTableName: 'User',
            referencedColumnNames: ['id'],
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
        ],
        indices: [],
        uniques: [
          {
            name: 'SourceRevision_segmentId_version_key',
            columnNames: ['segmentId', 'version'],
          },
        ],
      },
    ];

    for (const table of tables) await runner.createTable(new Table(table));
  }
  async down(): Promise<void> {
    throw new Error(
      '저장된 버전과 답안 보호를 위해 후속 마이그레이션을 사용해 주세요.'
    );
  }
}
