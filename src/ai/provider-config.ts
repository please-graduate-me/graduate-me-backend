import { HttpError } from '../common/http-error.js';
import type {
  ProviderIdentity,
  ProviderMode,
  ProviderName,
} from './provider-contracts.js';

/** 잘못된 설정을 다른 공급자로 조용히 대체하지 않는다. */
export function selectedAIProvider(): ProviderName {
  const provider = process.env.AI_PROVIDER?.trim() || 'naver';

  if (provider !== 'naver' && provider !== 'anthropic')
    throw new HttpError(
      503,
      'AI_PROVIDER는 naver 또는 anthropic으로 설정해 주세요.'
    );

  return provider;
}

/** 공급자의 키 존재 여부만 확인하며 연결 조회나 모델 호출은 하지 않는다. */
export function providerIdentity(
  provider: ProviderName,
  mode: ProviderMode = 'text'
): ProviderIdentity {
  if (provider === 'anthropic') {
    const model = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5';

    return {
      provider,
      model,
      configured:
        Boolean(process.env.ANTHROPIC_API_KEY?.trim()) &&
        /^claude-[a-z0-9-]{1,100}$/.test(model),
    };
  }

  const model =
    (mode === 'image'
      ? process.env.CLOVA_IMAGE_MODEL
      : process.env.CLOVA_TEXT_MODEL
    )?.trim() || (mode === 'image' ? 'HCX-005' : 'HCX-007');

  return {
    provider,
    model,
    configured:
      Boolean(process.env.CLOVA_STUDIO_API_KEY?.trim()) &&
      model === (mode === 'image' ? 'HCX-005' : 'HCX-007'),
  };
}

/** 화면의 생성 가능 여부와 실제 호출이 같은 선택 설정을 사용한다. */
export function activeProviderIdentity(mode: ProviderMode = 'text') {
  return providerIdentity(selectedAIProvider(), mode);
}
