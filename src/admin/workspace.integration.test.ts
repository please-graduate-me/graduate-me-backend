import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { HelperProfile } from '../database/entities/HelperProfile.entity.js';
import { LearningQuestion } from '../database/entities/LearningQuestion.entity.js';
import { ReviewRequest } from '../database/entities/ReviewRequest.entity.js';
import { SourceService } from '../learning/source.service.js';
import { QuestionsService } from '../learning/questions.service.js';
import { AdminService } from './admin.service.js';
import { WorkspaceAccessService } from './workspace-access.service.js';
import { WorkspaceQuestionsService } from './workspace-questions.service.js';
import {
  questionListQuerySchema,
  historyQuerySchema,
} from './workspace-contracts.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('관리 질문 목록의 전체 범위 필터와 권한', () => {
  const db = new DataSource(databaseOptions(testUrl));

  const owner = randomUUID(),
    helper = randomUUID(),
    other = randomUUID();

  const materialId = randomUUID();
  const ids = Array.from({ length: 27 }, () => randomUUID());
  const access = new WorkspaceAccessService(db, new AdminService(db));
  const questions = new QuestionsService(db, new SourceService(db), access);
  const workspace = new WorkspaceQuestionsService(db, access, questions);

  beforeAll(async () => {
    await db.initialize();
    await db.runMigrations();

    await db.manager.insert(
      User,
      [owner, helper, other].map((id) => ({ id, name: id }))
    );

    await db.manager.insert(HelperProfile, {
      userId: helper,
      languages: ['en'],
      materialIds: [materialId],
      active: true,
    });

    await db.manager.insert(
      LearningQuestion,
      ids.map((id, index) => ({
        id,
        ownerId: owner,
        assigneeId: index === 26 ? other : helper,
        title: '검색 대상',
        body: '원문 질문',
        status: index < 24 ? ('waiting' as const) : ('answered' as const),
        source: {
          kind: 'pdf' as const,
          materialId,
          title: '자료',
          page: 1,
          quote: 'Learning opens doors.',
          language: 'en' as const,
          version: 1,
        },
        createdAt:
          index === 25 ? new Date(Date.now() - 40 * 86_400_000) : new Date(),
      }))
    );

    const question = await db.manager.findOneByOrFail(LearningQuestion, {
      id: ids[24],
    });

    await db.manager.insert(ReviewRequest, {
      questionId: question.id,
      authorId: owner,
      authorName: '학생',
      scope: 'source',
      version: 'v1',
      reason: '확인 요청',
      source: question.source,
    });
  });

  afterAll(async () => {
    if (!db.isInitialized) return;
    await db.manager.delete(User, { id: In([owner, helper, other]) });
    await db.destroy();
  });

  it('다음 페이지의 답변 완료도 상태 필터에서 찾고 집계는 전체 배정 범위로 유지한다', async () => {
    const result = await workspace.list(
      helper,
      questionListQuerySchema.parse({ status: 'answered', limit: 20 })
    );

    expect(result.total).toBe(2);

    expect(result.items.map((row) => row.id).sort()).toEqual(
      [ids[24], ids[25]].sort()
    );

    expect(result.summary).toEqual({
      all: 26,
      waiting: 24,
      answered: 2,
      review: 1,
    });
  });

  it('기간과 미처리 검토 요청 조건을 페이지 분할 전에 적용한다', async () => {
    const recent = await workspace.list(
      helper,
      questionListQuerySchema.parse({ period: '7', status: 'answered' })
    );

    expect(recent.items.map((row) => row.id)).toEqual([ids[24]]);

    const review = await workspace.list(
      helper,
      questionListQuerySchema.parse({ status: 'review' })
    );

    expect(review.items.map((row) => row.id)).toEqual([ids[24]]);
    expect(review.summary.all).toBe(26);
  });

  it('최근 100건 이후의 검토 요청도 검색·페이지 이동·상세 조회하며 타인 권한은 열지 않는다', async () => {
    const question = await db.manager.findOneByOrFail(LearningQuestion, {
      id: ids[24],
    });

    const reviewIds = Array.from({ length: 102 }, () => randomUUID());

    await db.manager.insert(
      ReviewRequest,
      reviewIds.map((id, index) => ({
        id,
        questionId: question.id,
        authorId: owner,
        authorName: '학생',
        scope: 'source' as const,
        version: 'v1',
        reason: '과거 검토 검색',
        source: question.source,
        createdAt: new Date(Date.now() - index * 60_000),
      }))
    );

    const last = await workspace.reviews(
      helper,
      historyQuerySchema.parse({ page: 6, limit: 20, q: '과거 검토 검색' })
    );

    expect(last.total).toBe(102);
    expect(last.items).toHaveLength(2);

    expect((await workspace.review(helper, reviewIds[101])).id).toBe(
      reviewIds[101]
    );

    await expect(workspace.review(other, reviewIds[101])).rejects.toMatchObject(
      { status: 403 }
    );
  });
});
