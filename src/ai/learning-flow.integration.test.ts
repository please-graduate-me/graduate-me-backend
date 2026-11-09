import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { Video } from '../database/entities/Video.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import { SourceRevision } from '../database/entities/SourceRevision.entity.js';
import { User } from '../database/entities/User.entity.js';
import { HelperProfile } from '../database/entities/HelperProfile.entity.js';
import { LearningArtifact } from '../database/entities/LearningArtifact.entity.js';
import { ExerciseAttempt } from '../database/entities/ExerciseAttempt.entity.js';
import { MaterialAccess } from '../database/entities/MaterialAccess.entity.js';
import { AIUsage } from '../database/entities/AIUsage.entity.js';
import { AdminService } from '../admin/admin.service.js';
import { WorkspaceAccessService } from '../admin/workspace-access.service.js';
import { WorkspaceQuestionsService } from '../admin/workspace-questions.service.js';
import { ContentService } from '../admin/content.service.js';
import { MaterialsService } from '../learning/materials.service.js';
import { SourceService } from '../learning/source.service.js';
import { QuestionsService } from '../learning/questions.service.js';
import { ExpressionsService } from '../learning/expressions.service.js';
import { LearningService } from '../learning/learning.service.js';
import { ProviderService, type ProviderInput } from './provider.service.js';
import { UsageService } from './usage.service.js';
import { OperationService } from './operation.service.js';
import { ArtifactService } from './artifact.service.js';
import { LearningAIService } from './learning-ai.service.js';
import { ConversationService } from './conversation.service.js';
import { PracticeService } from './practice.service.js';
import { explanationInputSchema, practiceGenerateSchema } from './contracts.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)(
  '원문 AI 생성·대화·채점·도우미 수정의 저장 흐름',
  () => {
    const db = new DataSource(databaseOptions(testUrl));

    const owner = randomUUID(),
      helper = randomUUID(),
      other = randomUUID();

    const quote = 'Learning opens doors to new perspectives.';
    const secondQuote = 'Practice makes progress.';
    const ids: string[] = [];
    const videoIds: string[] = [];
    const sourceService = new SourceService(db);
    const materials = new MaterialsService(db);
    const artifacts = new ArtifactService(db);
    const usage = new UsageService(db);
    const operations = new OperationService(db);
    const access = new WorkspaceAccessService(db, new AdminService(db));
    const questions = new QuestionsService(db, sourceService, access);
    const workspace = new WorkspaceQuestionsService(db, access, questions);

    const content = new ContentService(
      db,
      access,
      workspace,
      questions,
      artifacts
    );

    const expressions = new ExpressionsService(db, sourceService);
    const learning = new LearningService(db, materials, expressions, questions);

    const generated = vi.fn(async (input: ProviderInput) => {
      const schema = input.schema as { properties: Record<string, unknown> };

      const data = JSON.parse(input.messages[1].content) as Record<
        string,
        unknown
      >;

      let value: unknown;

      if ('related' in schema.properties)
        value = {
          related: data.question !== '날씨 질문',
          clarification: '원문에 관한 질문을 해 주세요.',
        };
      else if ('translation' in schema.properties)
        value = {
          translation: '배움은 새로운 관점을 엽니다.',
          meaning: '새로운 기회',
          structure: '주어와 동사',
          concept: '배움의 가치',
          examples: ['A new example.'],
          uncertainty: '',
          citations: [{ quote }],
        };
      else if ('questions' in schema.properties) {
        const text = input.messages[0].content;

        const type = text.includes('type=short_answer')
          ? 'short_answer'
          : text.includes('type=free_response')
            ? 'free_response'
            : 'choice';

        const sources = data.expressions as { source: { quote: string } }[];

        value = {
          ambiguous: false,
          questions: (sources?.length > 1
            ? sources
            : [{ source: { quote } }]
          ).map((e, index) => ({
            type,
            question: `원문의 의미는 무엇인가요? ${index}`,
            choices: type === 'choice' ? ['기회', '문'] : [],
            answer: '기회',
            explanation: '비유적인 기회를 뜻합니다.',
            hint: '물리적인 문이 아닙니다.',
            sourceQuote: e.source.quote,
          })),
        };
      } else if ('feedback' in schema.properties)
        value = { feedback: '근거를 잘 설명했습니다. 사례를 보완해 보세요.' };
      else
        value = {
          text: '원문에서 doors는 기회를 비유합니다.',
          citations: [{ quote }],
          uncertainty: '',
        };

      return {
        text: JSON.stringify(value),
        provider: 'naver' as const,
        model: 'mock-HCX',
        inputTokens: 30,
        outputTokens: 40,
      };
    });

    const provider = {
      configured: true,
      generate: generated,
    } as unknown as ProviderService;

    const ai = new LearningAIService(
      db,
      provider,
      usage,
      operations,
      sourceService,
      artifacts
    );

    const conversations = new ConversationService(
      db,
      sourceService,
      ai,
      operations
    );

    const practice = new PracticeService(
      db,
      artifacts,
      ai,
      operations,
      sourceService
    );

    async function material(pages = [quote]) {
      const row = await materials.create(owner, {
        title: '테스트 원문',
        language: 'en',
        filename: 'source.pdf',
        pages,
        contentBase64: Buffer.from('%PDF-1.7\n%%EOF').toString('base64'),
      });

      ids.push(row.id);

      return row;
    }

    async function source() {
      const m = await material();

      return {
        kind: 'pdf' as const,
        materialId: m.id,
        page: 1,
        quote,
        version: 1,
      };
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
        {
          id: owner,
          name: '학생',
          explanationLanguage: 'th',
          level: 'intermediate',
          interests: ['문화'],
        },
        { id: helper, name: '도우미' },
        { id: other, name: '다른 계정' },
      ]);
    });

    afterAll(async () => {
      vi.unstubAllGlobals();
      if (!db.isInitialized) return;
      await db.manager.delete(User, { id: In([owner, helper, other]) });
      if (ids.length)
        await db.manager.delete(MaterialAccess, { id: In(ids), kind: 'pdf' });
      if (videoIds.length) await db.manager.delete(Video, { id: In(videoIds) });
      await db.destroy();
    });

    it('명시적 최초 준비와 상세 설명을 저장하고 재조회·같은 요청에는 생성하지 않는다', async () => {
      const selected = await source();
      const before = generated.mock.calls.length;

      const input = explanationInputSchema.parse({
        source: selected,
        requestId: randomUUID(),
      });

      const first = await ai.explain(owner, input);

      expect(first.payload.contextDescription).toContain('PDF v1');

      expect(generated.mock.calls.at(-1)?.[0].messages[0].content).toContain(
        'th'
      );

      expect(
        await ai.explain(owner, { ...input, requestId: randomUUID() })
      ).toMatchObject({ id: first.id });

      expect(await artifacts.get(owner, first.id)).toMatchObject({
        id: first.id,
      });

      expect(generated.mock.calls.length).toBe(before + 1);

      await expect(artifacts.get(other, first.id)).rejects.toMatchObject({
        status: 404,
      });

      const prepared = await ai.prepare(owner, selected.materialId, {
        fromPage: 1,
        toPage: 1,
        requestId: randomUUID(),
      });

      expect(prepared.failed).toEqual([]);
      expect(prepared.items).toHaveLength(1);
      const failedSource = await source();

      generated.mockRejectedValueOnce(new Error('모의 준비 실패'));

      const failed = await ai.prepare(owner, failedSource.materialId, {
        fromPage: 1,
        toPage: 1,
        requestId: randomUUID(),
      });

      expect(failed.failed).toHaveLength(1);
      const callsAfterFailure = generated.mock.calls.length;

      const retry = await ai.prepare(owner, failedSource.materialId, {
        fromPage: 1,
        toPage: 1,
        requestId: randomUUID(),
        explanationLanguage: 'en',
      });

      expect(retry.failed).toHaveLength(1);
      expect(generated.mock.calls.length).toBe(callsAfterFailure);
    });

    it('개인 대화는 열기만으로 호출하지 않고 무관한 질문에는 본문 생성을 중단한다', async () => {
      const selected = await source();
      const before = generated.mock.calls.length;
      const conversation = await conversations.open(owner, selected);

      await conversations.get(owner, conversation.id);
      expect(generated.mock.calls.length).toBe(before);
      const id = randomUUID();

      const answer = await conversations.message(
        owner,
        conversation.id,
        id,
        'doors의 의미가 뭔가요?'
      );

      expect(answer.messages.at(-1)).toMatchObject({
        status: 'ready',
        contextDescription: expect.stringContaining('PDF v1'),
      });

      await conversations.message(
        owner,
        conversation.id,
        id,
        'doors의 의미가 뭔가요?'
      );

      expect(generated.mock.calls.length).toBe(before + 2);

      const unrelated = await conversations.message(
        owner,
        conversation.id,
        randomUUID(),
        '날씨 질문'
      );

      expect(unrelated.messages.at(-1)?.status).toBe('out_of_scope');
      expect(generated.mock.calls.length).toBe(before + 3);

      await expect(
        conversations.get(other, conversation.id)
      ).rejects.toMatchObject({ status: 404 });
    });

    it('생성 문제는 정답을 숨기고 힌트·엄격 채점·같은 제출 재전송을 보존한다', async () => {
      const selected = await source();

      const result = await practice.generate(
        owner,
        practiceGenerateSchema.parse({
          source: selected,
          requestId: randomUUID(),
          language: 'en',
          count: 1,
        })
      );

      const item = result.items[0];

      expect(item.payload).not.toHaveProperty('answer');
      expect(item.payload).not.toHaveProperty('explanation');
      await practice.reveal(owner, item.id, 1, true);
      const id = randomUUID();

      const answer = await practice.answer(owner, item.id, {
        requestId: id,
        version: 1,
        answer: '기회가',
      });

      expect(answer).toMatchObject({
        correct: false,
        expectedAnswer: '기회',
        hintUsed: true,
        revealed: false,
      });

      expect(
        await practice.answer(owner, item.id, {
          requestId: id,
          version: 1,
          answer: '기회가',
        })
      ).toEqual(answer);

      expect(await db.manager.countBy(ExerciseAttempt, { id })).toBe(1);
      const before = generated.mock.calls.length;

      await practice.answer(owner, item.id, {
        requestId: randomUUID(),
        version: 1,
        answer: '기회',
      });

      expect(generated.mock.calls.length).toBe(before);

      await expect(
        practice.answer(other, item.id, {
          requestId: randomUUID(),
          version: 1,
          answer: '기회',
        })
      ).rejects.toMatchObject({ status: 404 });
    });

    it('도우미 실제 수정은 새 버전으로 검토하고 과거 답안을 바꾸지 않는다', async () => {
      const selected = await source();

      const item = (
        await practice.generate(
          owner,
          practiceGenerateSchema.parse({
            source: selected,
            requestId: randomUUID(),
            language: 'en',
            count: 1,
          })
        )
      ).items[0];

      const attempt = await practice.answer(owner, item.id, {
        requestId: randomUUID(),
        version: 1,
        answer: '기회',
      });

      await db.manager.save(HelperProfile, {
        userId: helper,
        languages: ['en'],
        materialIds: [selected.materialId],
        active: true,
        canReview: true,
        canEdit: false,
        canRequestEdit: true,
      });

      const question = await questions.create(owner, {
        source: selected,
        title: '문항 확인',
        body: '근거를 검토해 주세요.',
        assigneeId: helper,
        kind: 'report',
        attachment: { artifactId: item.id, version: 1 },
      });

      const row = await artifacts.owned(owner, item.id);
      const payload = (await artifacts.revision(row)).payload;

      await expect(
        content.revise(helper, 'practice', item.id, {
          questionId: question.id,
          expectedVersion: 1,
          payload,
          reason: '검토 수정',
        })
      ).rejects.toMatchObject({ status: 403 });

      await db.manager.update(
        HelperProfile,
        { userId: helper },
        { canEdit: true }
      );

      await expect(
        workspace.requestReview(helper, question.id, {
          scope: 'question',
          version: 'v1',
          reason: '잘못된 대상',
          target: { kind: 'practice', id: randomUUID(), version: 1 },
        })
      ).rejects.toMatchObject({ status: 404 });

      const updated = await content.revise(helper, 'practice', item.id, {
        questionId: question.id,
        expectedVersion: 1,
        payload: { ...payload, explanation: '수정된 해설' },
        reason: '해설 보완',
      });

      expect(updated).toMatchObject({ version: 2, needsReview: true });

      await practice.updateState(owner, item.id, {
        version: 2,
        excluded: true,
      });

      await expect(
        practice.answer(owner, item.id, {
          requestId: randomUUID(),
          version: 2,
          answer: '기회',
        })
      ).rejects.toMatchObject({ status: 409 });

      await content.review(helper, 'practice', item.id, {
        questionId: question.id,
        version: 1,
        status: 'verified',
        reason: '구버전만 확인',
      });

      expect((await artifacts.owned(owner, item.id)).needsReview).toBe(true);

      await content.review(helper, 'practice', item.id, {
        questionId: question.id,
        version: 2,
        status: 'verified',
        reason: '현재 버전 확인',
      });

      expect((await artifacts.owned(owner, item.id)).needsReview).toBe(false);

      expect((await practice.attempts(owner, item.id)).items[0]).toEqual(
        attempt
      );

      expect(await artifacts.get(owner, item.id)).toMatchObject({
        latestResult: null,
      });

      await content.visibility(helper, item.id, {
        questionId: question.id,
        version: 2,
        visible: false,
        reason: '노출 중단',
      });

      await practice.updateState(owner, item.id, {
        version: 2,
        excluded: true,
      });

      await questions.updateState(owner, question.id, { shared: false });

      await expect(workspace.detail(helper, question.id)).rejects.toMatchObject(
        { status: 404 }
      );
    });

    it('여러 원문 표현의 문제 근거를 각각 보존하고 자유 답변에 임의 정오를 매기지 않는다', async () => {
      const m = await material([quote, secondQuote]);

      const rows = await Promise.all(
        [quote, secondQuote].map((text, index) =>
          expressions.create(owner, {
            text,
            meaning: '뜻',
            note: '',
            source: {
              kind: 'pdf',
              materialId: m.id,
              page: index + 1,
              quote: text,
            },
            kind: 'sentence',
            reviewIncluded: true,
          })
        )
      );

      const batch = await practice.generate(
        owner,
        practiceGenerateSchema.parse({
          expressionIds: rows.map((r) => r.id),
          requestId: randomUUID(),
          language: 'en',
          count: 2,
        })
      );

      expect(batch.items.map((r) => r.source.quote).sort()).toEqual(
        [quote, secondQuote].sort()
      );

      const selected = {
        kind: 'pdf' as const,
        materialId: m.id,
        page: 1,
        quote,
      };

      const free = (
        await practice.generate(
          owner,
          practiceGenerateSchema.parse({
            source: selected,
            requestId: randomUUID(),
            language: 'en',
            count: 1,
            type: 'free_response',
          })
        )
      ).items[0];

      expect(
        await practice.answer(owner, free.id, {
          requestId: randomUUID(),
          version: 1,
          answer: '새로운 배움은 기회입니다.',
        })
      ).toMatchObject({ correct: null, feedback: expect.any(String) });

      const usageRows = await db.manager.findBy(AIUsage, { ownerId: owner });

      expect(
        usageRows.some(
          (r) => r.task === 'free_response_feedback' && r.status === 'succeeded'
        )
      ).toBe(true);
    });

    it('공개했어도 읽지 않은 자료를 개인 이력에 넣지 않고 실제 학습 활동을 연결한다', async () => {
      const m = await material();

      await db.manager.update(
        MaterialAccess,
        { id: m.id, kind: 'pdf' },
        { visibility: 'public' }
      );

      expect(
        (await materials.list(other)).items.some((r) => r.id === m.id)
      ).toBe(true);

      expect((await learning.summary(other)).materials).toBe(0);
      expect((await learning.history(other)).items).toEqual([]);
      await materials.update(other, m.id, { currentPage: 1 });
      expect((await learning.summary(other)).materials).toBe(1);

      expect((await learning.history(owner)).items.map((r) => r.kind)).toEqual(
        expect.arrayContaining([
          'exercise',
          'explanation',
          'conversation',
          'material',
          'question',
        ])
      );

      expect(
        (await db.manager.findBy(LearningArtifact, { ownerId: other })).length
      ).toBe(0);
    });

    it('과거 영상 원문은 당시 버전만 제공하고 최신 문맥이나 현재 정답 공개를 섞지 않는다', async () => {
      const video = await db.manager.save(Video, {
        ownerId: other,
        youtubeId: randomUUID().replaceAll('-', '').slice(0, 11),
        title: '버전 검증',
        language: 'en',
        duration: 30,
        visibility: 'accounts',
        allowedUserIds: [owner],
      });

      videoIds.push(video.id);

      const segment = await db.manager.save(Segment, {
        videoId: video.id,
        index: 0,
        text: 'A new sentence.',
        start: 0,
        end: 3,
        translation: '새 문장',
        words: [],
        version: 2,
      });

      await db.manager.save(Progress, { userId: owner, videoId: video.id });

      await db.manager.save(SourceRevision, {
        segmentId: segment.id,
        version: 1,
        payload: {
          text: quote,
          start: 0,
          end: 3,
          translation: '이전 번역',
          blankCandidates: [0],
        },
        actorId: null,
        actorName: '테스트',
        reason: '보존된 원문',
      });

      const archive = await sourceService.videoArchive(
        owner,
        video.id,
        segment.id,
        1
      );

      expect(archive).toMatchObject({
        text: quote,
        translation: '이전 번역',
        version: 1,
        currentVersion: 2,
      });

      const context = await sourceService.context(owner, archive.source);

      expect(context.context).toBe(quote);

      expect(context.contextDescription).toContain(
        '현재 버전의 인접 구절 제외'
      );

      await expect(
        sourceService.videoArchive(owner, video.id, segment.id, 2)
      ).rejects.toMatchObject({ status: 409 });

      await db.manager.update(Video, { id: video.id }, { allowedUserIds: [] });

      await expect(
        sourceService.videoArchive(owner, video.id, segment.id, 1)
      ).rejects.toMatchObject({ status: 404 });

      await expect(
        sourceService.resolve(owner, archive.source)
      ).rejects.toMatchObject({ status: 404 });
    });
  }
);
