import { EntitySchema } from 'typeorm';

/** ArtifactRevision의 계정·출처·버전 연결을 저장한다. */
export interface ArtifactRevision {
  id: string;
  artifactId: string;
  version: number;
  payload: Record<string, unknown>;
  actorId: string | null;
  actorName: string;
  reason: string;
  reviewStatus: 'unreviewed' | 'verified' | 'needs_review';
  status: 'ready' | 'suspended';
  createdAt: Date;
}

/** 생성 결과와 개인 기록의 저장 경계를 보존한다. */
export const ArtifactRevision = new EntitySchema<ArtifactRevision>({
  name: 'ArtifactRevision',
  tableName: 'ArtifactRevision',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    artifactId: {
      type: 'text',
    },
    version: {
      type: 'integer',
    },
    payload: {
      type: 'jsonb',
    },
    actorId: {
      type: 'text',
      nullable: true,
    },
    actorName: {
      type: 'text',
    },
    reason: {
      type: 'text',
    },
    reviewStatus: {
      type: 'text',
      default: () => "'unreviewed'",
    },
    status: {
      type: 'text',
      default: () => "'ready'",
    },
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'now()',
    },
  },
  foreignKeys: [
    {
      name: 'ArtifactRevision_artifactId_fkey',
      target: 'LearningArtifact',
      columnNames: ['artifactId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    {
      name: 'ArtifactRevision_actorId_fkey',
      target: 'User',
      columnNames: ['actorId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  ],
  indices: [],
  uniques: [
    {
      name: 'ArtifactRevision_artifactId_version_key',
      columns: ['artifactId', 'version'],
    },
  ],
});
