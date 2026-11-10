import { createHash } from 'node:crypto';
import type { Video } from '../database/entities/Video.entity.js';
import type { Segment } from '../database/entities/Segment.entity.js';
import type { VideoPlayback } from '../database/entities/VideoPlayback.entity.js';

/** 자료·구절 버전과 개인 회차가 달라지면 과거 위치를 새 원문의 재생 위치로 사용하지 않는다. */
export function playbackSnapshot(
  video: Pick<Video, 'analysisVersion'>,
  segments: Pick<Segment, 'id' | 'version' | 'start' | 'end'>[],
  cycle: number
) {
  const snapshot = {
    analysisVersion: video.analysisVersion,
    cycle,
    segments: segments.map((s) => ({
      id: s.id,
      version: s.version,
      start: s.start,
      end: s.end,
    })),
  };

  return {
    snapshot,
    watchVersion: createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex'),
  };
}

/** 최대 도달 시각은 시청 시간·완료율이 아니며 받아쓰기의 정답 구절 수에 더하지 않는다. */
export function playbackDto(row: VideoPlayback | null, watchVersion: string) {
  return {
    watchVersion,
    watchRevision: row?.revision ?? 0,
    playbackPosition: row?.playbackPosition ?? 0,
    scriptPosition: row?.scriptPosition ?? 0,
    scriptMaxPosition: row?.scriptMaxPosition ?? 0,
    watchMode:
      row?.lastInput.watchMode === 'script'
        ? ('script' as const)
        : ('dictation' as const),
  };
}
