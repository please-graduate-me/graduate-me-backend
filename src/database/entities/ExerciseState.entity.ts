import { EntitySchema } from 'typeorm';

/** ExerciseState의 계정·출처·버전 연결을 저장한다. */
export interface ExerciseState {
  id: string;
  ownerId: string;
  artifactId: string;
  version: number;
  draft: string;
  hintUsed: boolean;
  revealed: boolean;
  excluded: boolean;
  updatedAt: Date;
}

/** 생성 결과와 개인 기록의 저장 경계를 보존한다. */
export const ExerciseState = new EntitySchema<ExerciseState>({
  name: 'ExerciseState',
  tableName: 'ExerciseState',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    ownerId: {
      type: 'text',
    },
    artifactId: {
      type: 'text',
    },
    version: {
      type: 'integer',
    },
    draft: {
      type: 'text',
      default: () => "''",
    },
    hintUsed: {
      type: 'boolean',
      default: false,
    },
    revealed: {
      type: 'boolean',
      default: false,
    },
    excluded: {
      type: 'boolean',
      default: false,
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
      name: 'ExerciseState_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    {
      name: 'ExerciseState_artifactId_fkey',
      target: 'LearningArtifact',
      columnNames: ['artifactId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  ],
  indices: [],
  uniques: [
    {
      name: 'ExerciseState_ownerId_artifactId_version_key',
      columns: ['ownerId', 'artifactId', 'version'],
    },
  ],
});
