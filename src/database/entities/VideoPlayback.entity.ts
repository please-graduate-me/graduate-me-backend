import { EntitySchema } from 'typeorm';

/** 재생 위치는 자료 버전·개인 회차에 묶고 정답 진도와 독립적으로 보존한다. */
export interface VideoPlayback {
  progressId: string;
  watchVersion: string;
  analysisVersion: string;
  sourceSnapshot: Record<string, unknown>;
  cycle: number;
  playbackPosition: number;
  scriptPosition: number;
  scriptMaxPosition: number;
  revision: number;
  lastRequestId: string;
  lastInput: Record<string, unknown>;
  updatedAt: Date;
}

/** 원문 수정이나 개인 초기화 전의 시청 기록도 새 위치로 덮어쓰지 않는다. */
export const VideoPlayback = new EntitySchema<VideoPlayback>({
  name: 'VideoPlayback',
  tableName: 'VideoPlayback',
  columns: {
    progressId: { type: 'text', primary: true },
    watchVersion: { type: 'text', primary: true },
    analysisVersion: { type: 'text' },
    sourceSnapshot: { type: 'jsonb' },
    cycle: { type: 'integer' },
    playbackPosition: { type: 'double precision', default: 0 },
    scriptPosition: { type: 'double precision', default: 0 },
    scriptMaxPosition: { type: 'double precision', default: 0 },
    revision: { type: 'integer' },
    lastRequestId: { type: 'text' },
    lastInput: { type: 'jsonb' },
    updatedAt: {
      type: 'timestamp',
      precision: 3,
      updateDate: true,
      default: () => 'now()',
    },
  },
  foreignKeys: [
    {
      name: 'VideoPlayback_progressId_fkey',
      target: 'Progress',
      columnNames: ['progressId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  ],
  checks: [
    {
      name: 'VideoPlayback_position_check',
      expression:
        '"playbackPosition" >= 0 AND "scriptPosition" >= 0 AND "scriptMaxPosition" >= "scriptPosition" AND revision > 0 AND cycle >= 0',
    },
  ],
});
