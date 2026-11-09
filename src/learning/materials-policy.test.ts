import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { materialInputSchema } from './contracts.js';
import {
  MaterialsService,
  materialVersionInputSchema,
} from './materials.service.js';

beforeEach(() => vi.stubEnv('MATERIAL_POLICY_PROFILE', 'mvp'));
afterEach(() => vi.unstubAllEnvs());

async function pdf(pages: number) {
  const file = await PDFDocument.create();

  for (let i = 0; i < pages; i++) file.addPage([600, 800]);

  return Buffer.from(await file.save()).toString('base64');
}

it('등록·새 버전의 HTTP 입력에는 언어 학습 목적 확인이 필요하다', async () => {
  const input = {
    title: '자료',
    language: 'en',
    filename: 'source.pdf',
    pages: ['Learning opens doors.'],
    contentBase64: await pdf(1),
  };

  expect(materialInputSchema.safeParse(input).success).toBe(false);

  expect(
    materialVersionInputSchema.safeParse({ ...input, expectedVersion: 1 })
      .success
  ).toBe(false);

  expect(
    materialVersionInputSchema.safeParse({
      ...input,
      learningPurposeConfirmed: true,
      expectedVersion: 1,
    }).success
  ).toBe(true);

  expect(
    materialInputSchema.safeParse({ ...input, learningPurposeConfirmed: false })
      .success
  ).toBe(false);

  expect(
    materialInputSchema.safeParse({ ...input, learningPurposeConfirmed: true })
      .success
  ).toBe(true);
});

it('MVP 크기·실제 페이지 수·추출 페이지 불일치·손상 원본은 저장 전에 거부한다', async () => {
  const transaction = vi.fn();

  const service = new MaterialsService({
    transaction,
  } as unknown as DataSource);

  const input = {
    title: '자료',
    language: 'en' as const,
    filename: 'source.pdf',
    pages: ['Learning opens doors.'],
    contentBase64: await pdf(1),
  };

  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);

  oversized.write('%PDF-');

  await expect(
    service.create('owner', {
      ...input,
      contentBase64: oversized.toString('base64'),
    })
  ).rejects.toMatchObject({ status: 413 });

  await expect(
    service.create('owner', { ...input, contentBase64: await pdf(31) })
  ).rejects.toMatchObject({ status: 413 });

  await expect(
    service.create('owner', { ...input, contentBase64: await pdf(2) })
  ).rejects.toMatchObject({ status: 400 });

  await expect(
    service.create('owner', {
      ...input,
      contentBase64: Buffer.from('%PDF-1.7\ncorrupt').toString('base64'),
    })
  ).rejects.toMatchObject({ status: 400 });

  expect(transaction).not.toHaveBeenCalled();
});
