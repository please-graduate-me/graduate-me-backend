import { EntitySchema } from 'typeorm';
import type { z } from 'zod';
import type {
  AnalysisPage,
  analysisOverviewSchema,
} from '../../material-analysis/contracts.js';

/** 문서 분석을 원본 버전·소유자·해설 언어와 묶어 비동기 작업으로 보존한다. */
export interface MaterialAnalysis {
  id: string;
  materialId: string;
  version: number;
  ownerId: string;
  explanationLanguage: 'ko' | 'en' | 'th';
  status: 'queued' | 'running' | 'ready' | 'partial' | 'failed' | 'skipped';
  pages: AnalysisPage[];
  overview: z.infer<typeof analysisOverviewSchema> | null;
  error: string | null;
  requestId: string | null;
  leaseToken: string | null;
  heartbeatAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 원본 교체 후에도 이전 분석을 유지하고 같은 버전의 자동 중복 생성을 막는다. */
export const MaterialAnalysis = new EntitySchema<MaterialAnalysis>({
  name: 'MaterialAnalysis',
  tableName: 'MaterialAnalysis',
  columns: {
    id: { type: 'text', primary: true, default: () => 'gen_random_uuid()' },
    materialId: { type: 'text' },
    version: { type: 'integer' },
    ownerId: { type: 'text' },
    explanationLanguage: { type: 'text' },
    status: { type: 'text', default: 'queued' },
    pages: { type: 'jsonb', default: () => "'[]'" },
    overview: { type: 'jsonb', nullable: true },
    error: { type: 'text', nullable: true },
    requestId: { type: 'text', nullable: true },
    leaseToken: { type: 'text', nullable: true },
    heartbeatAt: { type: 'timestamp', precision: 3, nullable: true },
    createdAt: { type: 'timestamp', precision: 3, default: () => 'now()' },
    updatedAt: { type: 'timestamp', precision: 3, default: () => 'now()' },
  },
  checks: [
    {
      name: 'MaterialAnalysis_status_check',
      expression:
        "status IN ('queued','running','ready','partial','failed','skipped')",
    },
    {
      name: 'MaterialAnalysis_language_check',
      expression: "\"explanationLanguage\" IN ('ko','en','th')",
    },
    { name: 'MaterialAnalysis_version_check', expression: 'version > 0' },
  ],
  foreignKeys: [
    {
      name: 'MaterialAnalysis_source_fkey',
      target: 'MaterialVersion',
      columnNames: ['materialId', 'version'],
      referencedColumnNames: ['materialId', 'version'],
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    {
      name: 'MaterialAnalysis_ownerId_fkey',
      target: 'User',
      columnNames: ['ownerId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  ],
  uniques: [
    {
      name: 'MaterialAnalysis_materialId_version_key',
      columns: ['materialId', 'version'],
    },
    { name: 'MaterialAnalysis_requestId_key', columns: ['requestId'] },
  ],
  indices: [
    {
      name: 'MaterialAnalysis_status_createdAt_idx',
      columns: ['status', 'createdAt'],
    },
  ],
});
