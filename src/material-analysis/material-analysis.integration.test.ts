import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { Material } from '../database/entities/Material.entity.js';
import { MaterialAccess } from '../database/entities/MaterialAccess.entity.js';
import { MaterialAnalysis } from '../database/entities/MaterialAnalysis.entity.js';
import { AIUsage } from '../database/entities/AIUsage.entity.js';
import { MaterialsService } from '../learning/materials.service.js';
import { ProviderService, type ProviderInput } from '../ai/provider.service.js';
import { UsageService } from '../ai/usage.service.js';
import { PdfRasterizerService } from '../ocr/pdf-rasterizer.service.js';
import { MaterialAnalysisService } from './material-analysis.service.js';
import { MaterialAnalysisProcessor } from './material-analysis.processor.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)(
  'PDF 등록부터 전체 정리·복원·실패 페이지 재요청까지',
  () => {
    const db = new DataSource(databaseOptions(testUrl));

    const owner = randomUUID(),
      other = randomUUID();

    const materials = new MaterialsService(db);
    const queue = new MaterialAnalysisService(db);
    let failPage: number | null = null;
    let configured = true;

    const generate = vi.fn(async (input: ProviderInput) => {
      const data = JSON.parse(input.messages[1].content);

      if (data.page === failPage) throw new Error('모의 공급자 실패');
      const text = `Learning opens doors on page ${data.page}.`;

      const words = [
        {
          term: 'Learning',
          lemma: 'learn',
          partOfSpeech: '명사',
          meaning: '배움',
          example: text,
        },
      ];

      const value = {
        complete: true,
        blank: false,
        sourceText: text,
        translation: `${data.page}페이지 전체 번역`,
        pageSummary: `${data.page}페이지의 배움`,
        words,
        warnings: [],
        overview: {
          documentType: '강의 자료',
          introduction: `${data.totalPages}페이지 학습 자료`,
          summary: ['자료의 핵심 개념'],
          keyPoints: [
            {
              text: '현재까지의 핵심',
              pages: [
                ...data.processedPages.map((p: { page: number }) => p.page),
                data.page,
              ],
            },
          ],
          wordIds: [
            ...data.wordPool.map((word: { id: string }) => word.id),
            `${data.page}:0`,
          ].slice(0, 50),
        },
      };

      return {
        text: JSON.stringify(value),
        provider: 'naver' as const,
        model: 'mock-image',
        inputTokens: 10,
        outputTokens: 10,
      };
    });

    const provider = {
      identity: () => ({ provider: 'naver', model: 'mock-image', configured }),
      generate,
    } as unknown as ProviderService;

    const rasterizer = {
      rasterize: vi.fn(async () => ({
        data: Buffer.from('모의 이미지'),
        width: 600,
        height: 800,
      })),
    } as unknown as PdfRasterizerService;

    const processor = new MaterialAnalysisProcessor(
      db,
      queue,
      provider,
      new UsageService(db),
      rasterizer
    );

    async function upload(count = 2) {
      const pdf = await PDFDocument.create();

      for (let i = 0; i < count; i++) pdf.addPage([600, 800]);

      return materials.create(owner, {
        title: '전체 정리 자료',
        language: 'en',
        filename: 'source.pdf',
        contentBase64: Buffer.from(await pdf.save()).toString('base64'),
        pages: Array.from({ length: count }, () => 'Learning opens doors.'),
      });
    }

    async function claim(materialId: string, version = 1) {
      // 다른 테스트가 남긴 작업과 무관하게 이 원본을 먼저 선택한다.
      await db.manager.update(
        MaterialAnalysis,
        { materialId, version },
        { createdAt: new Date(0) }
      );

      const job = await queue.claim();

      expect(job).toMatchObject({ materialId, version });

      return job!;
    }

    beforeAll(async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          throw new Error('실제 외부 요청 금지');
        })
      );

      await db.initialize();
      await db.runMigrations();

      await db.manager.insert(User, [
        { id: owner, explanationLanguage: 'th' },
        { id: other },
      ]);
    });

    afterEach(async () => {
      failPage = null;
      configured = true;
      await db.manager.delete(Material, { ownerId: owner });
      await db.manager.delete(AIUsage, { ownerId: owner });
      generate.mockClear();
      vi.unstubAllEnvs();
    });

    afterAll(async () => {
      if (db.isInitialized) {
        await db.manager.delete(User, owner);
        await db.manager.delete(User, other);
        await db.destroy();
      }

      vi.unstubAllGlobals();
    });

    it('업로드와 동시에 해설 언어를 고정하고 조회는 생성 없이 결과를 복원한다', async () => {
      const material = await upload();
      const initial = await queue.get(owner, material.id, 1);

      expect(initial.analysis).toMatchObject({
        status: 'queued',
        explanationLanguage: 'th',
        totalPages: 2,
        completedPages: 0,
      });

      expect(generate).not.toHaveBeenCalled();
      const job = await claim(material.id);

      expect(await queue.claim()).not.toMatchObject({ id: job.id });
      await processor.process(job, new AbortController().signal);
      const completed = await queue.get(owner, material.id, 1);

      expect(completed.analysis).toMatchObject({
        status: 'ready',
        completedPages: 2,
      });

      expect(completed.analysis!.pages.map((page) => page.translation)).toEqual(
        ['1페이지 전체 번역', '2페이지 전체 번역']
      );

      expect(completed.analysis!.overview!.vocabulary).toHaveLength(1);
      expect(completed.analysis!.overview!.introduction).toContain('2페이지');
      expect(generate).toHaveBeenCalledTimes(2);
      expect(generate.mock.calls[0][0].image).toBeDefined();
      expect(generate.mock.calls[0][0].messages[0].content).toContain('태국어');
      await queue.get(owner, material.id, 1);
      await queue.retry(owner, material.id, 1, randomUUID());
      expect(generate).toHaveBeenCalledTimes(2);

      await expect(queue.get(other, material.id, 1)).rejects.toMatchObject({
        status: 404,
      });

      await db.manager.update(
        MaterialAccess,
        { id: material.id, kind: 'pdf' },
        { visibility: 'public' }
      );

      expect((await queue.get(other, material.id, 1)).analysis!.canRetry).toBe(
        false
      );

      await expect(
        queue.retry(other, material.id, 1, randomUUID())
      ).rejects.toMatchObject({ status: 403 });
    });

    it('실패한 페이지와 미처리 페이지만 다시 요청하고 동일 요청은 중복 생성하지 않는다', async () => {
      const material = await upload(3);

      failPage = 2;

      await processor.process(
        await claim(material.id),
        new AbortController().signal
      );

      expect((await queue.get(owner, material.id, 1)).analysis).toMatchObject({
        status: 'partial',
        completedPages: 1,
      });

      const requestId = randomUUID();

      await queue.retry(owner, material.id, 1, requestId);
      await queue.retry(owner, material.id, 1, requestId);
      failPage = null;

      await processor.process(
        await claim(material.id),
        new AbortController().signal
      );

      expect(
        generate.mock.calls.map(
          (call) => JSON.parse(call[0].messages[1].content).page
        )
      ).toEqual([1, 2, 2, 3]);

      expect((await queue.get(owner, material.id, 1)).analysis).toMatchObject({
        status: 'ready',
        completedPages: 3,
      });

      await queue.retry(owner, material.id, 1, requestId);

      expect((await queue.get(owner, material.id, 1)).analysis!.status).toBe(
        'ready'
      );
    });

    it('새 버전은 새 분석으로 접수하고 이전 결과를 보존한다', async () => {
      const material = await upload();

      await processor.process(
        await claim(material.id),
        new AbortController().signal
      );

      const pdf = await PDFDocument.create();

      pdf.addPage([600, 800]);
      await db.manager.update(User, owner, { explanationLanguage: 'en' });

      await materials.replace(owner, material.id, {
        title: '새 자료',
        language: 'en',
        filename: 'new.pdf',
        pages: ['New text.'],
        contentBase64: Buffer.from(await pdf.save()).toString('base64'),
        expectedVersion: 1,
      });

      expect((await queue.get(owner, material.id, 1)).analysis).toMatchObject({
        status: 'ready',
        explanationLanguage: 'th',
      });

      expect((await queue.get(owner, material.id, 2)).analysis).toMatchObject({
        status: 'queued',
        explanationLanguage: 'en',
        totalPages: 1,
      });

      await db.manager.update(User, owner, { explanationLanguage: 'th' });
    });

    it('30페이지를 잘라내지 않고 모두 정리하며 그 이상은 자동 호출하지 않는다', async () => {
      const material = await upload(30);

      await processor.process(
        await claim(material.id),
        new AbortController().signal
      );

      expect((await queue.get(owner, material.id, 1)).analysis).toMatchObject({
        status: 'ready',
        completedPages: 30,
        totalPages: 30,
      });

      expect(generate).toHaveBeenCalledTimes(30);
      const large = await upload(31);

      expect((await queue.get(owner, large.id, 1)).analysis!.status).toBe(
        'skipped'
      );

      await expect(
        queue.retry(owner, large.id, 1, randomUUID())
      ).rejects.toMatchObject({ status: 400 });
    });

    it('공급자 미설정·할당량 부족·서버 중단은 자동 재시도하지 않는다', async () => {
      const material = await upload();

      configured = false;

      await processor.process(
        await claim(material.id),
        new AbortController().signal
      );

      expect((await queue.get(owner, material.id, 1)).analysis!.status).toBe(
        'failed'
      );

      expect(generate).not.toHaveBeenCalled();
      configured = true;
      await queue.retry(owner, material.id, 1, randomUUID());
      vi.stubEnv('AI_DAILY_TOKEN_LIMIT', '1');

      await processor.process(
        await claim(material.id),
        new AbortController().signal
      );

      expect(
        (await queue.get(owner, material.id, 1)).analysis!.error
      ).toContain('한도');

      expect(generate).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
      await queue.retry(owner, material.id, 1, randomUUID());
      const abandoned = await claim(material.id);

      await db.manager.update(MaterialAnalysis, abandoned.id, {
        heartbeatAt: new Date(0),
      });

      expect(await queue.claim()).not.toMatchObject({ id: abandoned.id });

      expect((await queue.get(owner, material.id, 1)).analysis!.status).toBe(
        'failed'
      );

      await expect(queue.save(abandoned)).rejects.toMatchObject({
        status: 409,
      });
    });
  }
);
