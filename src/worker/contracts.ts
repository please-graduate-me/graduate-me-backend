/** 영상 정보와 분석 완료 결과만 작업 큐에 전달한다. */
export type ProcessorEvent =
  | {
      type: 'transcribing';
      title: string;
      duration: number;
      category: string | null;
      youtubeCategoryId: string | null;
    }
  | {
      type: 'complete';
      segments: {
        index: number;
        start: number;
        end: number;
        text: string;
        words: { word: string; start: number; end: number }[];
      }[];
    };

/** 실패 유형은 구분해 보존하되 자료 분석의 자동 재시도는 실행하지 않는다. */
export class ProcessingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
  }
}

/** DB 작업 소유권은 외부 API에 전달하지 않고 NestJS 안에서만 유지한다. */
export interface ClaimedJob {
  id: string;
  videoId: string;
  youtubeId: string;
  language?: 'en' | 'th';
  ownerId?: string | null;
  attempts: number;
  leaseToken: string;
}
