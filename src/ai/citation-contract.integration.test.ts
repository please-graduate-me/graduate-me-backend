import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { MaterialAccess } from '../database/entities/MaterialAccess.entity.js';
import { AIUsage } from '../database/entities/AIUsage.entity.js';
import { AIOperation } from '../database/entities/AIOperation.entity.js';
import { LearningArtifact } from '../database/entities/LearningArtifact.entity.js';
import { MaterialsService } from '../learning/materials.service.js';
import { SourceService } from '../learning/source.service.js';
import { ArtifactService } from './artifact.service.js';
import { LearningAIService } from './learning-ai.service.js';
import { UsageService } from './usage.service.js';
import { OperationService } from './operation.service.js';
import type { ProviderInput, ProviderService } from './provider.service.js';
import { HttpError } from '../common/http-error.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('인용 제약·사용량·확정 실패와 과거 결과 보존', () => {
  const db = new DataSource(databaseOptions(testUrl));

  const owner = randomUUID(),
    materialIds: string[] = [];

  const materials = new MaterialsService(db),
    artifacts = new ArtifactService(db);

  const selected = 'ฉันอ่านหนังสือ\u200bที่ห้องสมุด';
  const adjacent = 'วันนี้เราฝึกภาษาไทยด้วยกัน';

  const generate = vi.fn(async (input: ProviderInput) => {
    const payload = JSON.parse(input.messages[1].content) as {
      allowedCitationQuotes: string[];
    };

    return {
      text: JSON.stringify({
        translation: '직접 만든 예문 번역',
        meaning: '독서 상황',
        structure: '합성 예제 구조',
        concept: '학습 예제',
        examples: [],
        uncertainty: '',
        citations: [{ quote: payload.allowedCitationQuotes[0] }],
      }),
      provider: 'anthropic' as const,
      model: 'mock-citation-model',
      inputTokens: 20,
      outputTokens: 30,
    };
  });

  const ai = new LearningAIService(
    db,
    {
      identity: () => ({
        configured: true,
        provider: 'anthropic',
        model: 'mock-citation-model',
      }),
      generate,
    } as unknown as ProviderService,
    new UsageService(db),
    new OperationService(db),
    new SourceService(db),
    artifacts
  );

  let contentBase64: string;

  beforeAll(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('실제 외부 요청 금지');
      })
    );

    await db.initialize();
    await db.manager.insert(User, { id: owner });
    const pdf = await PDFDocument.create();

    pdf.addPage([600, 800]);
    contentBase64 = Buffer.from(await pdf.save()).toString('base64');
  });

  afterAll(async () => {
    vi.unstubAllGlobals();

    if (db.isInitialized) {
      for (const id of materialIds)
        await db.manager.delete(MaterialAccess, { id });
      await db.manager.delete(User, { id: owner });
      await db.destroy();
    }
  });

  async function material() {
    const row = await materials.create(owner, {
      learningPurposeConfirmed: true,
      title: '직접 만든 인용 검증 자료',
      language: 'th',
      filename: 'synthetic.pdf',
      contentBase64,
      pages: [`${selected}\n${adjacent}`],
    });

    materialIds.push(row.id);

    return {
      material: row,
      source: {
        kind: 'pdf' as const,
        materialId: row.id,
        page: 1,
        version: 1,
        quote: selected,
      },
    };
  }

  it('허용 인용은 선택 원문에 고정되고 원본 교체 후에도 기존 설명·메모·버전은 남는다', async () => {
    const { material: row, source } = await material();

    const result = await ai.explain(owner, {
      requestId: randomUUID(),
      source,
      mode: 'meaning',
    });

    const call = generate.mock.calls.at(-1)![0];
    const input = JSON.parse(call.messages[1].content);

    expect(input.allowedCitationQuotes).toEqual([selected]);
    expect(input.context).toContain(adjacent);

    expect(call.schema).toMatchObject({
      properties: {
        citations: { items: { properties: { quote: { enum: [selected] } } } },
      },
    });

    expect(result).toMatchObject({
      source: { version: 1, quote: selected },
      payload: { citations: [{ quote: selected }] },
    });

    const calls = generate.mock.calls.length;

    expect(
      await ai.explain(owner, {
        requestId: randomUUID(),
        source,
        mode: 'meaning',
      })
    ).toMatchObject({ id: result.id });

    expect(generate).toHaveBeenCalledTimes(calls);
    await materials.update(owner, row.id, { memo: '보존할 개인 메모' });

    await materials.replace(owner, row.id, {
      learningPurposeConfirmed: true,
      title: '직접 만든 새 원본',
      language: 'th',
      filename: 'synthetic.pdf',
      contentBase64,
      pages: [adjacent],
      expectedVersion: 1,
    });

    expect(await artifacts.get(owner, result.id)).toMatchObject({
      source: { version: 1, quote: selected },
      payload: { citations: [{ quote: selected }] },
    });

    expect(await materials.get(owner, row.id)).toMatchObject({
      version: 2,
      memo: '보존할 개인 메모',
    });

    expect(generate).toHaveBeenCalledTimes(calls);
  });

  it('문맥 인용을 거부하고 실측 토큰을 남기며 같은 실패 ID는 무호출·명시적 새 ID만 실행한다', async () => {
    const { source } = await material();
    const requestId = randomUUID();
    const input = { requestId, source, mode: 'meaning' as const };

    const artifactsBefore = await db.manager.countBy(LearningArtifact, {
      ownerId: owner,
    });

    generate.mockResolvedValueOnce({
      text: JSON.stringify({
        translation: '',
        meaning: '',
        structure: '',
        concept: '',
        examples: [],
        uncertainty: '',
        citations: [{ quote: adjacent }],
      }),
      provider: 'anthropic',
      model: 'mock-citation-model',
      inputTokens: 20,
      outputTokens: 30,
    });

    const failure = await ai.explain(owner, input).catch((error) => error);

    expect(failure).toBeInstanceOf(HttpError);

    expect((failure as HttpError).getResponse()).toMatchObject({
      code: 'AI_RESULT_REJECTED',
    });

    const count = generate.mock.calls.length;
    const replay = await ai.explain(owner, input).catch((error) => error);

    expect((replay as HttpError).getResponse()).toMatchObject({
      code: 'AI_OPERATION_FAILED',
    });

    expect(generate).toHaveBeenCalledTimes(count);

    expect(await db.manager.findOneBy(AIUsage, { requestId })).toMatchObject({
      status: 'failed',
      inputTokens: 20,
      outputTokens: 30,
    });

    expect(await db.manager.countBy(LearningArtifact, { ownerId: owner })).toBe(
      artifactsBefore
    );

    const saved = await ai.explain(owner, {
      ...input,
      requestId: randomUUID(),
    });

    expect(saved.source).toMatchObject({ version: 1, quote: selected });
    expect(generate).toHaveBeenCalledTimes(count + 1);

    expect(
      await db.manager.findOneBy(AIOperation, { id: requestId })
    ).toMatchObject({ status: 'failed', result: null });
  });
});
