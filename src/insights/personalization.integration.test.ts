import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { Job } from '../database/entities/Job.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import { Attempt } from '../database/entities/Attempt.entity.js';
import { Expression } from '../database/entities/Expression.entity.js';
import { Annotation } from '../database/entities/Annotation.entity.js';
import { LearningQuestion } from '../database/entities/LearningQuestion.entity.js';
import { AIConversation } from '../database/entities/AIConversation.entity.js';
import { AIMessage } from '../database/entities/AIMessage.entity.js';
import { ExerciseAttempt } from '../database/entities/ExerciseAttempt.entity.js';
import { AIOperation } from '../database/entities/AIOperation.entity.js';
import { AIUsage } from '../database/entities/AIUsage.entity.js';
import { SourceService } from '../learning/source.service.js';
import { LearningHistoryService } from '../ai/learning-history.service.js';
import { LearningAIService } from '../ai/learning-ai.service.js';
import { ProviderService, type ProviderInput } from '../ai/provider.service.js';
import { UsageService } from '../ai/usage.service.js';
import { OperationService } from '../ai/operation.service.js';
import { ArtifactService } from '../ai/artifact.service.js';
import { PracticeService } from '../ai/practice.service.js';
import { PersonalizationService } from './personalization.service.js';
import { InsightsService } from './insights.service.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)(
  '누적 학습 기록에서 AI 추천과 문제 생성까지의 연결',
  () => {
    const db = new DataSource(databaseOptions(testUrl));

    const owner = randomUUID(),
      other = randomUUID(),
      videoId = randomUUID(),
      segmentId = randomUUID();

    const expressionId = randomUUID();

    const quote =
      'If you practice every day, you will improve your language skills.';

    const source = {
      kind: 'video' as const,
      videoId,
      segmentId,
      quote,
      version: 1,
      title: '조건문 학습',
      language: 'en' as const,
    };

    const sources = new SourceService(db);
    const history = new LearningHistoryService(db, sources);
    const operations = new OperationService(db);
    const artifacts = new ArtifactService(db);

    const generated = vi.fn(async (input: ProviderInput) => {
      const data = JSON.parse(input.messages[1].content);

      const value = data.candidates
        ? {
            summary: {
              text: '조건문 관련 표현과 질문이 있습니다.',
              evidenceIds: [`expression:${expressionId}`],
            },
            focusAreas: [
              {
                text: '조건문의 문맥을 복습하세요.',
                evidenceIds: [`expression:${expressionId}`],
              },
            ],
            recommendations: [
              {
                videoId,
                reason: '저장한 조건문과 관련된 구절이 있습니다.',
                evidenceIds: [`expression:${expressionId}`],
              },
            ],
          }
        : {
            ambiguous: false,
            questions: [
              {
                type: 'choice',
                question: '어떤 조건을 말하나요?',
                choices: ['매일 연습', '쉬기'],
                answer: '매일 연습',
                explanation: '매일 연습하면 실력이 향상됩니다.',
                hint: '빈도를 보세요.',
                sourceQuote: quote,
              },
            ],
          };

      return {
        text: JSON.stringify(value),
        provider: 'naver' as const,
        model: 'mock',
        inputTokens: 10,
        outputTokens: 10,
      };
    });

    const provider = {
      identity: () => ({ provider: 'naver', model: 'mock', configured: true }),
      generate: generated,
    } as unknown as ProviderService;

    const ai = new LearningAIService(
      db,
      provider,
      new UsageService(db),
      operations,
      sources,
      artifacts
    );

    const personalization = new PersonalizationService(
      db,
      history,
      ai,
      operations
    );

    const insights = new InsightsService(db, personalization);

    const practice = new PracticeService(
      db,
      artifacts,
      ai,
      operations,
      sources,
      history
    );

    beforeAll(async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          throw new Error('실제 외부 요청 금지');
        })
      );

      await db.initialize();
      await db.runMigrations();
      await db.manager.insert(User, [{ id: owner }, { id: other }]);

      await db.manager.insert(Video, {
        id: videoId,
        youtubeId: randomUUID().slice(0, 11),
        title: '조건문 학습',
        language: 'en',
        visibility: 'public',
      });

      await db.manager.insert(Job, { videoId, status: 'ready' });

      await db.manager.insert(Segment, {
        id: segmentId,
        videoId,
        index: 0,
        start: 0,
        end: 10,
        text: quote,
        words: [],
      });

      const progress = await db.manager.save(Progress, {
        userId: owner,
        videoId,
      });

      await db.manager.insert(Attempt, [
        {
          id: randomUUID(),
          progressId: progress.id,
          segmentId,
          mode: 'full',
          answer: 'If you practice.',
          correct: false,
          result: { sourceVersion: 1, revealed: false, hintCount: 0 },
        },
        {
          id: randomUUID(),
          progressId: progress.id,
          segmentId,
          mode: 'full',
          answer: '제외할 힌트 사용 답안',
          correct: false,
          result: { sourceVersion: 1, revealed: false, hintCount: 1 },
        },
        {
          id: randomUUID(),
          progressId: progress.id,
          segmentId,
          mode: 'full',
          answer: '제외할 과거 답안',
          correct: false,
          result: { sourceVersion: 0, revealed: false, hintCount: 0 },
        },
      ]);

      await db.manager.insert(Expression, [
        {
          id: expressionId,
          ownerId: owner,
          source,
          text: 'If you practice',
          meaning: '조건문',
        },
        { ownerId: other, source, text: '다른 계정의 비공개 표현' },
        {
          ownerId: owner,
          source: { ...source, language: 'th' },
          text: '다른 언어',
        },
        { ownerId: owner, source, text: '복습 제외', reviewIncluded: false },
        {
          ownerId: owner,
          source,
          text: '오래된 기록',
          updatedAt: new Date(Date.now() - 40 * 86400000),
        },
      ]);

      await db.manager.insert(Annotation, {
        ownerId: owner,
        source,
        color: 'yellow',
        memo: '조건절 메모',
      });

      await db.manager.insert(LearningQuestion, {
        ownerId: owner,
        source,
        title: '조건문 질문',
        body: '시제를 설명해 주세요.',
      });

      const conversation = await db.manager.save(AIConversation, {
        ownerId: owner,
        source,
      });

      await db.manager.insert(AIMessage, {
        conversationId: conversation.id,
        role: 'user',
        text: '이 문장은 어떤 조건인가요?',
        status: 'ready',
        citations: [],
      });

      const artifact = await artifacts.create(db.manager, {
        ownerId: owner,
        kind: 'practice',
        source,
        payload: {},
        model: 'mock',
        provider: 'naver',
        expressionIds: [],
        parentIds: [],
        batchId: randomUUID(),
      });

      await db.manager.insert(ExerciseAttempt, {
        id: randomUUID(),
        ownerId: owner,
        artifactId: artifact.id,
        version: 1,
        answer: '틀린 답',
        correct: false,
        expectedAnswer: '정답',
        explanation: '설명',
        source,
        questionPayload: { question: '조건문 질문' },
        hintUsed: false,
        revealed: false,
      });
    });

    afterAll(async () => {
      if (db.isInitialized) {
        await db.manager.delete(AIOperation, { ownerId: owner });
        await db.manager.delete(AIUsage, { ownerId: owner });
        await db.manager.delete(User, owner);
        await db.manager.delete(User, other);
        await db.manager.delete(Video, videoId);
        await db.destroy();
      }

      vi.unstubAllGlobals();
    });

    it('여섯 종류의 계정·언어별 기록을 수집하고 도움받은 답안·과거 기록을 제외한다', async () => {
      const result = await history.collect(owner, 'en');

      expect(new Set(result.evidence.map((e) => e.kind))).toEqual(
        new Set([
          'dictation_mistake',
          'exercise_mistake',
          'saved_expression',
          'annotation',
          'helper_question',
          'ai_question',
        ])
      );

      expect(result.evidence).toHaveLength(6);
      expect(JSON.stringify(result)).not.toContain('제외할');
      expect(JSON.stringify(result)).not.toContain('다른 계정');
      expect(JSON.stringify(result)).not.toContain('오래된 기록');
      expect((await history.collect(owner, 'th')).evidence).toHaveLength(0);
    });

    it('명시적 요청에서 분석을 저장하고 조회·동일 요청 재전송에는 추가 생성하지 않는다', async () => {
      const before = generated.mock.calls.length;
      const requestId = randomUUID();

      expect(
        (await insights.recommendations(owner, 'en')).personalization
      ).toBeNull();

      const result = await insights.personalize(owner, 'en', requestId);

      expect(result.personalization).toMatchObject({
        evidenceCount: 6,
        provider: 'naver',
      });

      expect(result.items[0].id).toBe(videoId);
      expect(result.items[0].reason).toContain('조건문');
      await insights.personalize(owner, 'en', requestId);
      await insights.recommendations(owner, 'en');
      expect(generated).toHaveBeenCalledTimes(before + 1);
    });

    it('선택 원문을 유지하면서 누적 기록을 새 문제 생성에 전달한다', async () => {
      await practice.generate(owner, {
        requestId: randomUUID(),
        expressionIds: [expressionId],
        language: 'en',
        type: 'choice',
        count: 1,
        style: 'flex',
        skill: 'reading',
      });

      const call = generated.mock.calls.at(-1)![0];
      const input = JSON.parse(call.messages[1].content);

      expect(input.learningHistory).toHaveLength(6);
      expect(input.expressions[0].source.quote).toBe(quote);
    });

    it('추천 자료 접근 철회 후에는 저장 분석을 노출하지 않는다', async () => {
      await db.manager.update(Video, videoId, {
        ownerId: other,
        visibility: 'private',
      });

      expect((await history.collect(owner, 'en')).evidence).toHaveLength(0);
      const result = await insights.recommendations(owner, 'en');

      expect(result.personalization).toBeNull();
      expect(result.items.some((item) => item.id === videoId)).toBe(false);
    });
  }
);
