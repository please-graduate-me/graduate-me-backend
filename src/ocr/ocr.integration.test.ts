import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { MaterialAccess } from '../database/entities/MaterialAccess.entity.js';
import { MaterialOcrPage } from '../database/entities/MaterialOcrPage.entity.js';
import { AIUsage } from '../database/entities/AIUsage.entity.js';
import { MaterialsService } from '../learning/materials.service.js';
import { SourceService } from '../learning/source.service.js';
import { SourceInput, sourceInputSchema } from '../learning/contracts.js';
import { OperationService } from '../ai/operation.service.js';
import { UsageService } from '../ai/usage.service.js';
import { ArtifactService, sameSource } from '../ai/artifact.service.js';
import { LearningAIService } from '../ai/learning-ai.service.js';
import { ProviderService } from '../ai/provider.service.js';
import { HttpError } from '../common/http-error.js';
import { OcrProviderService } from './ocr-provider.service.js';
import { OcrService } from './ocr.service.js';
import type {
  OcrResult,
  OcrProviderResult,
  OcrProviderIdentity,
} from './contracts.js';

const url = process.env.TEST_DATABASE_URL;

if (url && !new URL(url).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!url)('PDF OCR 저장·권한·재사용과 학습 원문 연결', () => {
  const db = new DataSource(databaseOptions(url));

  const ownerId = randomUUID(),
    readerId = randomUUID();

  const materials = new MaterialsService(db),
    sources = new SourceService(db),
    usage = new UsageService(db),
    operations = new OperationService(db);

  const result: OcrResult = {
    text: 'Recognized line',
    fields: [
      {
        text: 'Recognized line',
        rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
        confidence: 0.75,
        lineBreak: true,
      },
    ],
    width: 600,
    height: 800,
    lowConfidenceCount: 1,
  };

  let identity: OcrProviderIdentity = {
    provider: 'naver',
    model: 'CLOVA OCR General V2',
    configured: true,
    supportedLanguages: ['en'],
  };

  const providerResult = (): OcrProviderResult => ({
    result,
    provider: identity.provider,
    model: identity.model,
    inputTokens: null,
    outputTokens: null,
  });

  const recognize = vi.fn(async () => providerResult());

  const ocr = new OcrService(
    db,
    {
      identity: () => identity,
      reservation: () =>
        identity.provider === 'anthropic'
          ? { estimatedInputTokens: 13000, reservedOutputTokens: 8192 }
          : { estimatedInputTokens: 0, reservedOutputTokens: 0 },
      recognize,
    } as unknown as OcrProviderService,
    usage,
    operations
  );

  let materialId: string, contentBase64: string, ocrId: string;

  const age = () =>
    db.query(
      'UPDATE "MaterialOcrPage" SET "updatedAt" = now() - interval \'2 seconds\''
    );

  beforeAll(async () => {
    await db.initialize();
    await db.runMigrations();
    vi.stubEnv('AI_DAILY_BUDGET_USD', '0');
    vi.stubEnv('AI_DAILY_REQUEST_LIMIT', '100');
    vi.stubEnv('OCR_ESTIMATED_USD_PER_PAGE', '0.012');
    vi.stubEnv('AI_NAVER_INPUT_USD_PER_MILLION', '900');
    vi.stubEnv('AI_NAVER_OUTPUT_USD_PER_MILLION', '900');
    vi.stubEnv('AI_ANTHROPIC_INPUT_USD_PER_MILLION', '');
    vi.stubEnv('AI_ANTHROPIC_OUTPUT_USD_PER_MILLION', '');
    await db.manager.insert(User, [{ id: ownerId }, { id: readerId }]);
    const pdf = await PDFDocument.create();

    pdf.addPage([600, 800]);
    pdf.addPage([600, 800]);
    contentBase64 = Buffer.from(await pdf.save()).toString('base64');

    const material = await materials.create(ownerId, {
      title: '스캔 원본',
      language: 'en',
      filename: 'scan.pdf',
      contentBase64,
      pages: ['', 'Native neighbor.'],
    });

    materialId = material.id;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await db.manager.delete(User, { id: ownerId });
    await db.manager.delete(User, { id: readerId });
    await db.destroy();
  });

  it('GET은 호출하지 않고 동일 페이지 중복과 비소유자의 생성을 차단한다', async () => {
    expect(
      (await ocr.get(ownerId, materialId, { version: 1, page: 1 })).item
    ).toBeNull();

    expect(recognize).not.toHaveBeenCalled();
    let complete!: (value: OcrProviderResult) => void;

    recognize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );

    const running = ocr.recognize(ownerId, materialId, {
      requestId: randomUUID(),
      version: 1,
      page: 1,
    });

    await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));

    expect(
      (await ocr.get(ownerId, materialId, { version: 1, page: 1 })).item?.status
    ).toBe('running');

    await expect(
      ocr.recognize(ownerId, materialId, {
        requestId: randomUUID(),
        version: 1,
        page: 1,
      })
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      ocr.recognize(ownerId, materialId, {
        requestId: randomUUID(),
        version: 1,
        page: 2,
      })
    ).rejects.toMatchObject({ status: 429 });

    await expect(
      ocr.get(readerId, materialId, { version: 1, page: 1 })
    ).rejects.toMatchObject({ status: 404 });

    await db.manager.update(
      MaterialAccess,
      { id: materialId, kind: 'pdf' },
      { visibility: 'public' }
    );

    expect(
      (await ocr.get(readerId, materialId, { version: 1, page: 1 })).item
        ?.status
    ).toBe('running');

    await expect(
      ocr.recognize(readerId, materialId, {
        requestId: randomUUID(),
        version: 1,
        page: 1,
      })
    ).rejects.toMatchObject({ status: 403 });

    complete(providerResult());
    const ready = await running;

    expect(ready.item).toMatchObject({
      status: 'ready',
      text: result.text,
      lowConfidenceCount: 1,
    });

    ocrId = ready.item!.id;

    await ocr.recognize(ownerId, materialId, {
      requestId: randomUUID(),
      version: 1,
      page: 1,
    });

    expect(recognize).toHaveBeenCalledTimes(1);

    const records = await db.manager.findBy(AIUsage, {
      ownerId,
      task: 'pdf_ocr',
    });

    expect(records).toHaveLength(1);

    expect(records[0]).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      reservedTokens: 0,
      estimatedCost: 0.012,
      actualCost: null,
    });

    expect((await materials.get(ownerId, materialId)).pages[0]).toBe('');
  });

  it('OCR 근거를 원본·페이지·버전에 검증하고 준비 설명과 조회 필터에 보존한다', async () => {
    const input: SourceInput = {
      kind: 'pdf',
      materialId,
      page: 1,
      version: 1,
      ocrId,
      quote: result.text,
    };

    const source = await sources.resolve(ownerId, input);

    expect(source).toMatchObject({ ocrId, version: 1, quote: result.text });

    await expect(
      sources.resolve(ownerId, { ...input, ocrId: undefined })
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      sources.resolve(ownerId, { ...input, page: 2 })
    ).rejects.toMatchObject({ status: 404 });

    expect(source.kind).toBe('pdf');
    if (source.kind !== 'pdf') throw new Error('PDF 원문이 필요합니다.');
    expect(sameSource(source, { ...source, ocrId: undefined })).toBe(false);

    expect(
      sourceInputSchema.safeParse({
        ...input,
        rects: [{ x: 0.9, y: 0, width: 0.2, height: 0.1 }],
      }).success
    ).toBe(false);

    expect(await sources.context(ownerId, input)).toMatchObject({
      contextDescription: expect.stringContaining('OCR'),
      context: expect.stringContaining('Native neighbor.'),
    });

    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        translation: '인식 문장',
        meaning: '뜻',
        structure: '구조',
        concept: '개념',
        examples: [],
        uncertainty: '인식 원문 대조 필요',
        citations: [{ quote: result.text }],
      }),
      model: 'HCX-007',
      provider: 'naver',
      inputTokens: 20,
      outputTokens: 30,
    }));

    const artifacts = new ArtifactService(db);

    const ai = new LearningAIService(
      db,
      {
        identity: () => ({
          provider: 'naver',
          model: 'HCX-007',
          configured: true,
        }),
        configured: true,
        generate,
      } as unknown as ProviderService,
      usage,
      operations,
      sources,
      artifacts
    );

    const prepared = await ai.prepare(ownerId, materialId, {
      requestId: randomUUID(),
      fromPage: 1,
      toPage: 1,
    });

    expect(prepared.failed).toEqual([]);

    expect(prepared.items[0]).toMatchObject({
      source: { ocrId, version: 1 },
      payload: { contextDescription: expect.stringContaining('OCR') },
    });

    expect(
      (
        await artifacts.list(ownerId, 'explanation', {
          materialId,
          page: 1,
          version: 1,
          ocrId,
        })
      ).items
    ).toHaveLength(1);

    expect(
      (
        await artifacts.list(ownerId, 'explanation', {
          materialId,
          page: 1,
          version: 1,
          ocrId: 'none',
        })
      ).items
    ).toHaveLength(0);

    expect(
      (
        await artifacts.list(ownerId, 'explanation', {
          materialId,
          page: 1,
          version: 2,
          ocrId,
        })
      ).items
    ).toHaveLength(0);
  });

  it('실패는 자동 재시도하지 않고 새 명시 요청으로 복구하며 이전 OCR은 불변이다', async () => {
    await age();
    recognize.mockRejectedValueOnce(new HttpError(502, 'OCR 연결 실패'));
    const requestId = randomUUID();

    await expect(
      ocr.recognize(ownerId, materialId, { requestId, version: 1, page: 2 })
    ).rejects.toMatchObject({ status: 502 });

    expect(
      (await ocr.get(ownerId, materialId, { version: 1, page: 2 })).item
    ).toMatchObject({ status: 'failed', text: '', fields: [] });

    const calls = recognize.mock.calls.length;

    await expect(
      ocr.recognize(ownerId, materialId, { requestId, version: 1, page: 2 })
    ).rejects.toMatchObject({ status: 502 });

    expect(recognize).toHaveBeenCalledTimes(calls);
    await age();

    expect(
      (
        await ocr.recognize(ownerId, materialId, {
          requestId: randomUUID(),
          version: 1,
          page: 2,
        })
      ).item?.status
    ).toBe('ready');

    await materials.replace(ownerId, materialId, {
      title: '새 원본',
      language: 'en',
      filename: 'scan.pdf',
      contentBase64,
      pages: ['', 'Native neighbor.'],
      expectedVersion: 1,
    });

    expect(
      (await ocr.get(ownerId, materialId, { version: 1, page: 1 })).item?.id
    ).toBe(ocrId);

    await expect(
      ocr.recognize(ownerId, materialId, {
        requestId: randomUUID(),
        version: 1,
        page: 1,
      })
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      sources.resolve(ownerId, {
        kind: 'pdf',
        materialId,
        version: 2,
        page: 1,
        ocrId,
        quote: result.text,
      })
    ).rejects.toMatchObject({ status: 404 });

    expect(
      (
        await sources.resolve(ownerId, {
          kind: 'pdf',
          materialId,
          version: 1,
          page: 1,
          ocrId,
          quote: result.text,
        })
      ).version
    ).toBe(1);
  });

  it('과거 중단은 실패로 정리하고 계정 한도·Thai 미지원은 공급자 호출 전에 차단한다', async () => {
    const abandoned = await db.manager.save(MaterialOcrPage, {
      materialId,
      version: 2,
      page: 1,
      requestId: randomUUID(),
      status: 'running',
      updatedAt: new Date(Date.now() - 31 * 60000),
    });

    expect(
      (await ocr.get(ownerId, materialId, { version: 2, page: 1 })).item
    ).toMatchObject({ id: abandoned.id, status: 'failed' });

    await age();
    const calls = recognize.mock.calls.length;

    vi.stubEnv('AI_DAILY_REQUEST_LIMIT', '1');

    await expect(
      ocr.recognize(ownerId, materialId, {
        requestId: randomUUID(),
        version: 2,
        page: 1,
      })
    ).rejects.toMatchObject({
      status: 429,
      response: { error: expect.stringContaining('오늘의 AI 사용 한도') },
    });

    expect(recognize).toHaveBeenCalledTimes(calls);

    await materials.replace(ownerId, materialId, {
      title: '태국어',
      language: 'th',
      filename: 'scan.pdf',
      contentBase64,
      pages: ['', ''],
      expectedVersion: 2,
    });

    expect(
      await ocr.get(ownerId, materialId, { version: 3, page: 1 })
    ).toMatchObject({
      languageSupported: false,
      supportedLanguages: ['en'],
      item: null,
    });

    await expect(
      ocr.recognize(ownerId, materialId, {
        requestId: randomUUID(),
        version: 3,
        page: 1,
      })
    ).rejects.toMatchObject({ status: 422 });

    expect(recognize).toHaveBeenCalledTimes(calls);
  });

  it('Claude 전환은 실제 토큰·미제공 신뢰도를 기록하고 이전 결과와 요청 식별자를 보존한다', async () => {
    identity = {
      provider: 'anthropic',
      model: 'claude-mock-v1',
      configured: true,
      supportedLanguages: ['en', 'th'],
    };

    vi.stubEnv('AI_DAILY_REQUEST_LIMIT', '100');
    vi.stubEnv('AI_DAILY_TOKEN_LIMIT', '100');
    await age();
    const calls = recognize.mock.calls.length;

    await expect(
      ocr.recognize(ownerId, materialId, {
        requestId: randomUUID(),
        version: 3,
        page: 1,
      })
    ).rejects.toMatchObject({ status: 429 });

    expect(recognize).toHaveBeenCalledTimes(calls);
    vi.stubEnv('AI_DAILY_TOKEN_LIMIT', '100000');
    await age();

    const claudeResult: OcrProviderResult = {
      result: {
        ...result,
        text: 'สวัสดี',
        fields: result.fields.map((f) => ({
          ...f,
          text: 'สวัสดี',
          confidence: null,
        })),
        lowConfidenceCount: 0,
      },
      provider: 'anthropic',
      model: identity.model,
      inputTokens: 1200,
      outputTokens: 150,
    };

    recognize.mockResolvedValueOnce(claudeResult);

    const ready = await ocr.recognize(ownerId, materialId, {
      requestId: randomUUID(),
      version: 3,
      page: 1,
    });

    expect(ready).toMatchObject({
      provider: 'anthropic',
      supportedLanguages: ['en', 'th'],
      languageSupported: true,
      item: {
        provider: 'anthropic',
        model: 'claude-mock-v1',
        text: 'สวัสดี',
        lowConfidenceCount: 0,
        fields: [expect.objectContaining({ confidence: null })],
      },
    });

    expect(
      (await ocr.get(ownerId, materialId, { version: 1, page: 1 })).item
    ).toMatchObject({
      id: ocrId,
      provider: 'naver',
      model: 'CLOVA OCR General V2',
      text: result.text,
    });

    const measured = await db.manager.findOneByOrFail(AIUsage, {
      ownerId,
      provider: 'anthropic',
      status: 'succeeded',
    });

    expect(measured).toMatchObject({
      inputTokens: 1200,
      outputTokens: 150,
      reservedTokens: 21192,
      estimatedCost: null,
    });

    await age();
    recognize.mockRejectedValueOnce(new HttpError(502, '모의 인식 실패'));
    const failedId = randomUUID();

    await expect(
      ocr.recognize(ownerId, materialId, {
        requestId: failedId,
        version: 3,
        page: 2,
      })
    ).rejects.toMatchObject({ status: 502 });

    identity = { ...identity, model: 'claude-mock-v2' };

    await expect(
      ocr.recognize(ownerId, materialId, {
        requestId: failedId,
        version: 3,
        page: 2,
      })
    ).rejects.toMatchObject({ status: 409 });

    identity = {
      provider: 'naver',
      model: 'CLOVA OCR General V2',
      configured: false,
      supportedLanguages: ['en'],
    };

    const beforeReuse = recognize.mock.calls.length;

    expect(
      await ocr.recognize(ownerId, materialId, {
        requestId: randomUUID(),
        version: 3,
        page: 1,
      })
    ).toMatchObject({
      provider: 'naver',
      languageSupported: false,
      item: { provider: 'anthropic', text: 'สวัสดี' },
    });

    expect(recognize).toHaveBeenCalledTimes(beforeReuse);
  });
});
