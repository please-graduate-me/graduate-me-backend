import { HttpError } from '../common/http-error.js';

function configuredLimit(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] || fallback);

  return Number.isFinite(value) && value >= 1
    ? Math.min(maximum, Math.floor(value))
    : fallback;
}

/** 개발 Compose의 MVP 설정과 기존 운영 설정을 같은 공개 계약으로 제공한다. */
export function materialPolicy() {
  const profile = process.env.MATERIAL_POLICY_PROFILE?.trim() || 'standard';

  if (profile !== 'mvp' && profile !== 'standard')
    throw new HttpError(503, '자료 정책은 mvp 또는 standard로 설정해 주세요.');
  const mvp = profile === 'mvp';

  return {
    profile,
    pdf: {
      maxBytes: (mvp ? 5 : 10) * 1024 * 1024,
      maxPages: mvp ? 30 : 200,
      dailyNewLimit: mvp ? 5 : 20,
      preparationPages: configuredLimit(
        'AI_PREPARATION_PAGE_LIMIT',
        mvp ? 3 : 10,
        mvp ? 3 : 20
      ),
    },
    video: {
      maxSeconds: mvp ? 600 : 1800,
      dailyNewLimit: configuredLimit(
        'VIDEO_DAILY_LIMIT',
        mvp ? 3 : 10,
        mvp ? 3 : 100
      ),
      transcriptionEnabled:
        (process.env.VIDEO_TRANSCRIPTION_PROVIDER?.trim() || 'gemini') ===
        'gemini',
    },
    ai: {
      dailyRequests: configuredLimit(
        'AI_DAILY_REQUEST_LIMIT',
        mvp ? 30 : 100,
        mvp ? 30 : 10000
      ),
      dailyTokens: configuredLimit(
        'AI_DAILY_TOKEN_LIMIT',
        mvp ? 50000 : 200000,
        mvp ? 50000 : 10000000
      ),
      concurrentRequests: configuredLimit(
        'AI_CONCURRENT_REQUEST_LIMIT',
        mvp ? 1 : 2,
        mvp ? 1 : 20
      ),
    },
    suitability: {
      requiresLearningConfirmation: true,
      minTargetLetters: 8,
      subjectsRestricted: false,
    },
  };
}

/** 자료 주제와 별개로 학습에 사용할 최소 문자 단서만 판정한다. */
export function assessLearningText(text: string, language: 'en' | 'th') {
  if (!text.trim())
    return {
      status: 'needs_ocr' as const,
      aiAllowed: false,
      reason:
        '추출된 글자가 없습니다. 스캔 PDF라면 OCR 후 원문을 확인해 주세요.',
    };
  let letters = 0;
  let targetLetters = 0;
  const minimum = materialPolicy().suitability.minTargetLetters;
  const target = language === 'th' ? /\p{Script=Thai}/u : /\p{Script=Latin}/u;

  for (const letter of text.normalize('NFKC')) {
    if (!/\p{L}/u.test(letter)) continue;
    letters++;
    if (target.test(letter)) targetLetters++;
    if (targetLetters >= minimum)
      return {
        status: 'eligible' as const,
        aiAllowed: true,
        reason:
          '선택한 언어의 글자가 포함되어 있습니다. 원문을 확인하며 학습해 주세요.',
      };
  }

  return letters < minimum
    ? {
        status: 'insufficient_text' as const,
        aiAllowed: false,
        reason:
          '학습할 글자가 너무 적습니다. 문장이 포함된 페이지나 구절을 선택해 주세요.',
      }
    : {
        status: 'language_mismatch' as const,
        aiAllowed: false,
        reason: `선택한 ${language === 'th' ? '태국어' : '영어'}의 글자를 충분히 찾지 못했습니다. 자료 언어와 원문을 확인해 주세요.`,
      };
}

/** 부적합한 원문은 새 AI 비용만 제한하고 저장 원본과 기록은 보존한다. */
export function assertLearningEligibility(
  eligibility: ReturnType<typeof assessLearningText>
) {
  if (!eligibility.aiAllowed) throw new HttpError(422, eligibility.reason);
}
