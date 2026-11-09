import { Inject, Injectable } from '@nestjs/common';
import { ClovaProviderService } from './clova-provider.service.js';
import { AnthropicProviderService } from './anthropic-provider.service.js';
import { selectedAIProvider } from './provider-config.js';
import type { ProviderInput, ProviderMode } from './provider-contracts.js';

/** 기존 업무가 공급자 상세 타입을 직접 참조하지 않게 한다. */
export type { ProviderInput, ProviderResult } from './provider-contracts.js';

@Injectable()
/** 환경에서 명시한 공급자만 호출하며 키 누락이나 오류에 자동 대체하지 않는다. */
export class ProviderService {
  constructor(
    @Inject(ClovaProviderService)
    private readonly clova: ClovaProviderService = new ClovaProviderService(),
    @Inject(AnthropicProviderService)
    private readonly anthropic: AnthropicProviderService = new AnthropicProviderService()
  ) {}
  private selected() {
    return selectedAIProvider() === 'anthropic' ? this.anthropic : this.clova;
  }
  identity(mode: ProviderMode = 'text') {
    return this.selected().identity(mode);
  }
  get configured() {
    return this.identity().configured;
  }
  generate(input: ProviderInput, signal?: AbortSignal) {
    return this.selected().generate(input, signal);
  }
}
