import { EntitySchema } from 'typeorm';

/** SourceRevision의 계정·출처·버전 연결을 저장한다. */
export interface SourceRevision {
  id: string;
  segmentId: string;
  version: number;
  payload: Record<string, unknown>;
  actorId: string | null;
  actorName: string;
  reason: string;
  reviewStatus: 'unreviewed' | 'verified' | 'needs_review';
  createdAt: Date;
}

/** 생성 결과와 개인 기록의 저장 경계를 보존한다. */
export const SourceRevision = new EntitySchema<SourceRevision>({
  name: 'SourceRevision',
  tableName: 'SourceRevision',
  columns: {
    id: {
      type: 'text',
      primary: true,
      default: () => 'gen_random_uuid()',
    },
    segmentId: {
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
    createdAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'now()',
    },
  },
  foreignKeys: [
    {
      name: 'SourceRevision_segmentId_fkey',
      target: 'Segment',
      columnNames: ['segmentId'],
      referencedColumnNames: ['id'],
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    {
      name: 'SourceRevision_actorId_fkey',
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
      name: 'SourceRevision_segmentId_version_key',
      columns: ['segmentId', 'version'],
    },
  ],
});
