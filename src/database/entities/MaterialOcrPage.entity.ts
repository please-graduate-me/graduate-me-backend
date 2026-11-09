import { EntitySchema } from 'typeorm';
import type { OcrField } from '../../ocr/contracts.js';

/** OCR은 원본 PDF와 추출된 텍스트를 덮어쓰지 않는 독립된 페이지 층이다. */
export interface MaterialOcrPage {
  id: string;
  materialId: string;
  version: number;
  page: number;
  requestId: string;
  status: 'running' | 'ready' | 'failed';
  text: string;
  fields: OcrField[];
  width: number | null;
  height: number | null;
  lowConfidenceCount: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 완료 OCR은 같은 원본 버전과 페이지에서 하나만 유지한다. */
export const MaterialOcrPage = new EntitySchema<MaterialOcrPage>({
  name: 'MaterialOcrPage',
  tableName: 'MaterialOcrPage',
  columns: {
    id: { type: 'text', primary: true, default: () => 'gen_random_uuid()' },
    materialId: { type: 'text' },
    version: { type: 'integer' },
    page: { type: 'integer' },
    requestId: { type: 'text' },
    status: { type: 'text' },
    text: { type: 'text', default: '' },
    fields: { type: 'jsonb', default: () => "'[]'" },
    width: { type: 'integer', nullable: true },
    height: { type: 'integer', nullable: true },
    lowConfidenceCount: { type: 'integer', default: 0 },
    error: { type: 'text', nullable: true },
    createdAt: { type: 'timestamp', precision: 3, default: () => 'now()' },
    updatedAt: {
      type: 'timestamp',
      precision: 3,
      default: () => 'now()',
      updateDate: true,
    },
  },
  checks: [
    {
      name: 'MaterialOcrPage_location_check',
      expression: 'version > 0 AND page BETWEEN 1 AND 200',
    },
    {
      name: 'MaterialOcrPage_status_check',
      expression: "status IN ('running', 'ready', 'failed')",
    },
  ],
  foreignKeys: [
    {
      name: 'MaterialOcrPage_materialId_fkey',
      target: 'Material',
      columnNames: ['materialId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  ],
  uniques: [
    {
      name: 'MaterialOcrPage_materialId_version_page_key',
      columns: ['materialId', 'version', 'page'],
    },
  ],
  indices: [
    {
      name: 'MaterialOcrPage_status_updatedAt_idx',
      columns: ['status', 'updatedAt'],
    },
  ],
});
