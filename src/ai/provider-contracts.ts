/** 실행 환경에서 선택할 수 있는 텍스트·이미지 공급자이다. */
export type ProviderName = 'naver' | 'anthropic';

/** 같은 업무가 텍스트와 이미지 모델을 구분하도록 한다. */
export type ProviderMode = 'text' | 'image';

/** 호출 전 예약과 캐시 분리에 사용하는 공급자 설정이다. */
export interface ProviderIdentity {
  provider: ProviderName;
  model: string;
  configured: boolean;
}

/** 공급자 메시지 형식은 서버 내부에서만 변환한다. */
export interface ProviderInput {
  model?: ProviderMode;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  schema?: Record<string, unknown>;
  image?: { base64: string; mimeType: 'image/png' | 'image/jpeg' };
}

/** 출력 검증보다 먼저 확인한 공급자 실측값을 기록한다. */
export type RecordProviderUsage = (
  measurement: Omit<ProviderResult, 'text'>
) => Promise<void>;

/** 공급자가 반환한 모델과 측정 토큰을 결과와 함께 보존한다. */
export interface ProviderResult {
  text: string;
  provider: ProviderName;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}
