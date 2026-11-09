import { afterEach, expect, it, vi } from 'vitest';
import {
  materialPolicy,
  assessLearningText,
  assertLearningEligibility,
} from './material-policy.js';
import { registerVideoSchema } from '../videos/contracts.js';
import { materialInputSchema } from './contracts.js';

afterEach(() => vi.unstubAllEnvs());

it('MVP 정책은 기존의 큰 환경 한도보다 우선하고 저장 원본의 일반 한도와 구분한다', () => {
  vi.stubEnv('MATERIAL_POLICY_PROFILE', 'mvp');
  vi.stubEnv('AI_DAILY_REQUEST_LIMIT', '100');
  vi.stubEnv('AI_DAILY_TOKEN_LIMIT', '200000');
  vi.stubEnv('AI_CONCURRENT_REQUEST_LIMIT', '2');
  vi.stubEnv('AI_PREPARATION_PAGE_LIMIT', '10');
  vi.stubEnv('VIDEO_DAILY_LIMIT', '10');

  expect(materialPolicy()).toMatchObject({
    pdf: {
      maxBytes: 5 * 1024 * 1024,
      maxPages: 30,
      dailyNewLimit: 5,
      preparationPages: 3,
    },
    video: { maxSeconds: 600, dailyNewLimit: 3 },
    ai: { dailyRequests: 30, dailyTokens: 50000, concurrentRequests: 1 },
  });

  vi.stubEnv('MATERIAL_POLICY_PROFILE', 'standard');
  expect(materialPolicy().pdf.maxPages).toBe(200);
  expect(materialPolicy().video.maxSeconds).toBe(1800);
});

it('선택 언어 단서를 확인하고 빈 스캔본과 숫자 자료를 구분한다', () => {
  expect(assessLearningText('Practice makes progress.', 'en').aiAllowed).toBe(
    true
  );

  expect(assessLearningText('การฝึกฝนทำให้ก้าวหน้า', 'th').aiAllowed).toBe(
    true
  );

  expect(
    assessLearningText('한국어만 포함된 수업 자료입니다.', 'en').status
  ).toBe('language_mismatch');

  expect(assessLearningText('Practice makes progress.', 'th').status).toBe(
    'language_mismatch'
  );

  expect(assessLearningText(' \n ', 'en').status).toBe('needs_ocr');

  expect(assessLearningText('12345 + 67890', 'en').status).toBe(
    'insufficient_text'
  );

  expect(() =>
    assertLearningEligibility(assessLearningText('12345', 'en'))
  ).toThrow();
});

it('자료 등록의 학습 목적 확인은 화면을 우회한 요청에서도 필수다', () => {
  const video = { url: 'https://youtu.be/VHZI9_we5GQ', language: 'en' };

  const pdf = {
    title: '자료',
    language: 'en',
    filename: 'sample.pdf',
    contentBase64: 'JVBERi0xLjQ=',
    pages: ['Practice makes progress.'],
  };

  expect(registerVideoSchema.safeParse(video).success).toBe(false);
  expect(materialInputSchema.safeParse(pdf).success).toBe(false);

  expect(
    registerVideoSchema.safeParse({ ...video, learningPurposeConfirmed: true })
      .success
  ).toBe(true);

  expect(
    materialInputSchema.safeParse({ ...pdf, learningPurposeConfirmed: true })
      .success
  ).toBe(true);
});
