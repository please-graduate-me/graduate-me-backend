import type { RecordProviderUsage } from '../ai/provider-contracts.js';
import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../common/http-error.js';
import { ClovaOcrProviderService } from './clova-ocr-provider.service.js';
import { ClaudeOcrProviderService } from './claude-ocr-provider.service.js';
import type { OcrProviderIdentity, OcrProviderResult } from './contracts.js';

@Injectable()
/** 업무 API를 바꾸지 않고 설정한 OCR 공급자만 명시적으로 호출한다. */
export class OcrProviderService {
  constructor(
    @Inject(ClovaOcrProviderService)
    private readonly clova: ClovaOcrProviderService,
    @Inject(ClaudeOcrProviderService)
    private readonly claude: ClaudeOcrProviderService
  ) {}
  identity(): OcrProviderIdentity {
    const selected = process.env.OCR_PROVIDER?.trim() || 'clova';

    if (selected === 'clova') return this.clova.identity();
    if (selected === 'anthropic') return this.claude.identity();
    throw new HttpError(
      503,
      'OCR_PROVIDER는 clova 또는 anthropic으로 설정해 주세요.'
    );
  }
  get configured() {
    return this.identity().configured;
  }
  reservation(identity: OcrProviderIdentity) {
    return identity.provider === 'anthropic'
      ? this.claude.reservation()
      : { estimatedInputTokens: 0, reservedOutputTokens: 0 };
  }
  async recognize(
    input: { data: Buffer; width: number; height: number; requestId: string },
    expected: OcrProviderIdentity,
    recordUsage?: RecordProviderUsage
  ): Promise<OcrProviderResult> {
    const current = this.identity();

    if (
      expected.provider !== current.provider ||
      expected.model !== current.model
    )
      throw new HttpError(
        409,
        'OCR 공급자 설정이 변경되었습니다. 새 요청으로 실행해 주세요.'
      );
    if (!current.configured)
      throw new HttpError(503, '선택한 OCR 공급자의 연결 설정이 필요합니다.');
    if (current.provider === 'anthropic')
      return this.claude.recognize(input, recordUsage);

    return {
      result: await this.clova.recognize(input, recordUsage),
      provider: current.provider,
      model: current.model,
      inputTokens: null,
      outputTokens: null,
    };
  }
}
