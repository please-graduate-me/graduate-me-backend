import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { DataSource, In } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { MaterialRegistration } from '../database/entities/MaterialRegistration.entity.js';
import { MaterialOcrPage } from '../database/entities/MaterialOcrPage.entity.js';
import { MaterialsService } from './materials.service.js';
import { SourceService } from './source.service.js';
import { ExpressionsService } from './expressions.service.js';
import { UsageService } from '../ai/usage.service.js';
import { OperationService } from '../ai/operation.service.js';
import { ArtifactService } from '../ai/artifact.service.js';
import { LearningAIService } from '../ai/learning-ai.service.js';
import { ConversationService } from '../ai/conversation.service.js';
import { PracticeService } from '../ai/practice.service.js';
import type { ProviderService } from '../ai/provider.service.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('MVP PDF 등록 한도와 유료 AI 적합성 경계', () => {
  const db = new DataSource(databaseOptions(testUrl));

  const materials = new MaterialsService(db),
    sources = new SourceService(db),
    artifacts = new ArtifactService(db),
    usage = new UsageService(db),
    operations = new OperationService(db);

  const owner = randomUUID(),
    learner = randomUUID();

  const generate = vi.fn();

  const ai = new LearningAIService(
    db,
    {
      identity: () => ({
        configured: true,
        provider: 'anthropic',
        model: 'mock-model',
      }),
      generate,
    } as unknown as ProviderService,
    usage,
    operations,
    sources,
    artifacts
  );

  const conversations = new ConversationService(db, sources, ai, operations);
  const practice = new PracticeService(db, artifacts, ai, operations, sources);
  let contentBase64: string;
  const sentence = 'Learning opens doors to new perspectives.';

  const input = () => ({
    title: '원본 자료',
    language: 'en' as const,
    filename: 'source.pdf',
    pages: [sentence],
    contentBase64,
  });

  beforeAll(async () => {
    vi.stubEnv('MATERIAL_POLICY_PROFILE', 'mvp');

    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('실제 외부 요청 금지');
      })
    );

    await db.initialize();
    await db.runMigrations();
    await db.manager.insert(User, [{ id: owner }, { id: learner }]);
    const file = await PDFDocument.create();

    file.addPage([600, 800]);
    contentBase64 = Buffer.from(await file.save()).toString('base64');
  });

  afterAll(async () => {
    if (db.isInitialized) {
      await db.manager.delete(User, { id: In([owner, learner]) });
      await db.destroy();
    }

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('동시 신규 등록을 5개로 제한하고 삭제·새 버전으로 일일 한도가 초기화되지 않는다', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        materials.create(owner, input()).then(
          (value) => ({ ok: true as const, value }),
          (error: { status: number }) => ({ ok: false as const, error })
        )
      )
    );

    expect(results.filter((result) => result.ok)).toHaveLength(5);

    expect(results.find((result) => !result.ok)).toMatchObject({
      error: { status: 429 },
    });

    const saved = results.flatMap((result) =>
      result.ok ? [result.value] : []
    );

    await materials.remove(owner, saved[0].id);

    await expect(materials.create(owner, input())).rejects.toMatchObject({
      status: 429,
    });

    expect(
      await db.manager.countBy(MaterialRegistration, { ownerId: owner })
    ).toBe(5);

    expect(
      await materials.replace(owner, saved[1].id, {
        ...input(),
        title: '새 버전',
        expectedVersion: 1,
      })
    ).toMatchObject({ version: 2 });

    expect((await materials.get(owner, saved[1].id, 1)).version).toBe(1);
    const yesterday = new Date();

    yesterday.setUTCHours(0, 0, 0, 0);
    yesterday.setMilliseconds(-1);

    await db.manager.update(
      MaterialRegistration,
      { materialId: saved[0].id },
      { createdAt: yesterday }
    );

    expect((await materials.create(owner, input())).version).toBe(1);
  });

  it('OCR 대기·언어 불일치는 새 AI 호출만 막고 원문·표현·기존 채점 결과는 보존한다', async () => {
    const scan = await materials.create(learner, { ...input(), pages: [''] });

    expect(scan).toMatchObject({
      eligibility: { status: 'needs_ocr', aiAllowed: false },
      pageEligibility: [{ status: 'needs_ocr' }],
    });

    await expect(
      ai.prepare(learner, scan.id, {
        requestId: randomUUID(),
        fromPage: 1,
        toPage: 1,
      })
    ).rejects.toMatchObject({ status: 422 });

    const text = '한글로만 작성한 학습 자료입니다.';

    const material = await materials.create(learner, {
      ...input(),
      pages: [text],
    });

    const source = {
      kind: 'pdf' as const,
      materialId: material.id,
      page: 1,
      version: 1,
      quote: text,
    };

    expect((await sources.context(learner, source)).eligibility.status).toBe(
      'language_mismatch'
    );

    await new ExpressionsService(db, sources).create(learner, {
      source,
      text: '학습',
      meaning: '뜻',
      note: '',
    });

    await expect(
      ai.explain(learner, { requestId: randomUUID(), source, mode: 'meaning' })
    ).rejects.toMatchObject({ status: 422 });

    const conversation = await conversations.open(learner, source);

    await expect(
      conversations.message(
        learner,
        conversation.id,
        randomUUID(),
        '뜻을 설명해 주세요'
      )
    ).rejects.toMatchObject({ status: 422 });

    await expect(
      practice.generate(learner, {
        requestId: randomUUID(),
        source,
        language: 'en',
        type: 'choice',
        count: 1,
      })
    ).rejects.toMatchObject({ status: 422 });

    const payload = {
      type: 'free_response',
      question: '보존된 문항',
      choices: [],
      answer: '예시',
      explanation: '보존된 설명',
      hint: '힌트',
      sourceQuote: text,
    };

    const free = await db.transaction((tx) =>
      artifacts.create(tx, {
        ownerId: learner,
        kind: 'practice',
        source: { ...source, title: '자료', language: 'en' },
        model: 'saved-model',
        provider: 'naver',
        payload,
      })
    );

    await expect(
      practice.answer(learner, free.id, {
        requestId: randomUUID(),
        version: 1,
        answer: '내 답안',
      })
    ).rejects.toMatchObject({ status: 422 });

    const old = await db.transaction((tx) =>
      artifacts.create(tx, {
        ownerId: learner,
        kind: 'practice',
        source: { ...source, title: '자료', language: 'en' },
        model: 'saved-model',
        provider: 'naver',
        payload: {
          ...payload,
          type: 'choice',
          choices: ['정답', '오답'],
          answer: '정답',
        },
      })
    );

    expect(
      await practice.answer(learner, old.id, {
        requestId: randomUUID(),
        version: 1,
        answer: '정답',
      })
    ).toMatchObject({ correct: true });

    expect((await artifacts.get(learner, free.id)).id).toBe(free.id);
    expect((await materials.get(learner, material.id)).pages).toEqual([text]);

    const ocr = await db.manager.save(MaterialOcrPage, {
      materialId: scan.id,
      version: 1,
      page: 1,
      requestId: randomUUID(),
      status: 'ready',
      text: sentence,
      fields: [],
    });

    expect(await materials.get(learner, scan.id)).toMatchObject({
      eligibility: { status: 'eligible', aiAllowed: true },
      pageEligibility: [{ aiAllowed: true }],
    });

    expect(
      (
        await sources.context(learner, {
          kind: 'pdf',
          materialId: scan.id,
          page: 1,
          version: 1,
          ocrId: ocr.id,
          quote: sentence,
        })
      ).eligibility.aiAllowed
    ).toBe(true);

    expect(generate).not.toHaveBeenCalled();
  });

  it('새 제한을 넘는 과거 원본은 조회 가능하고 새 등록·교체에만 MVP 제한을 적용한다', async () => {
    vi.stubEnv('MATERIAL_POLICY_PROFILE', 'standard');
    const document = await PDFDocument.create();

    for (let i = 0; i < 31; i++) document.addPage([600, 800]);

    const oversized = {
      ...input(),
      contentBase64: Buffer.from(await document.save()).toString('base64'),
      pages: Array.from({ length: 31 }, () => sentence),
    };

    const legacy = await materials.create(learner, oversized);

    vi.stubEnv('MATERIAL_POLICY_PROFILE', 'mvp');
    expect((await materials.get(learner, legacy.id)).pageCount).toBe(31);

    expect(
      (await materials.file(learner, legacy.id)).content.length
    ).toBeGreaterThan(0);

    await expect(
      materials.replace(learner, legacy.id, {
        ...oversized,
        title: '교체 원본',
        expectedVersion: 1,
      })
    ).rejects.toMatchObject({ status: 413 });

    expect((await materials.get(learner, legacy.id, 1)).version).toBe(1);
  });
});
