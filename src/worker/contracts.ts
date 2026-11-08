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

/** 실제 처리 실패와 실행 환경 실패를 같은 재시도 정책으로 전달한다. */
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
  attempts: number;
  leaseToken: string;
}
