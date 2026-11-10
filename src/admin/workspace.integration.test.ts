import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { HelperProfile } from '../database/entities/HelperProfile.entity.js';
import { LearningQuestion } from '../database/entities/LearningQuestion.entity.js';
import { Material } from '../database/entities/Material.entity.js';
import { MaterialAccess } from '../database/entities/MaterialAccess.entity.js';
import { Job } from '../database/entities/Job.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { CommunityService } from '../community/community.service.js';
import { ReviewEvent } from '../database/entities/ReviewEvent.entity.js';
import { WorkspaceOperationsService } from './workspace-operations.service.js';
import { ReviewRequest } from '../database/entities/ReviewRequest.entity.js';
import { SourceService } from '../learning/source.service.js';
import { QuestionsService } from '../learning/questions.service.js';
import { AdminService } from './admin.service.js';
import { WorkspaceAccessService } from './workspace-access.service.js';
import { WorkspaceQuestionsService } from './workspace-questions.service.js';
import {
  questionListQuerySchema,
  historyQuerySchema,
  processingUsageQuerySchema,
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
  const videoId = randomUUID();
  const ids = Array.from({ length: 27 }, () => randomUUID());
  const access = new WorkspaceAccessService(db, new AdminService(db));
  const questions = new QuestionsService(db, new SourceService(db), access);
  const workspace = new WorkspaceQuestionsService(db, access, questions);
  const operations = new WorkspaceOperationsService(db, questions);

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
    await db.manager.delete(Video, { id: videoId });
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

  it('자료 종류·접근 범위·실제 소유자와 페이지 분할을 원본 없이 반환한다', async () => {
    const title = `검수자료-${materialId}`;

    await db.manager.insert(Material, {
      id: materialId,
      ownerId: owner,
      title,
      language: 'en',
      filename: '원본.pdf',
      content: Buffer.from('원본비공개'),
      pages: ['원문 비공개'],
      memo: '개인 메모',
    });

    await db.manager.insert(MaterialAccess, {
      id: materialId,
      kind: 'pdf',
      visibility: 'public',
      allowedUserIds: [],
      version: 1,
    });

    await db.manager.insert(Video, {
      id: videoId,
      ownerId: owner,
      title,
      youtubeId: videoId,
      visibility: 'private',
    });

    const first = await operations.materials(
      historyQuerySchema.parse({ q: title, limit: 1 })
    );

    expect(first.total).toBe(2);
    expect(first.hasMore).toBe(true);

    const second = await operations.materials(
      historyQuerySchema.parse({ q: title, limit: 1, page: 2 })
    );

    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);

    const video = await operations.materials(
      historyQuerySchema.parse({ q: title, status: 'video' })
    );

    expect(video.items[0]).toMatchObject({
      id: videoId,
      owner: { id: owner },
      visibility: 'private',
    });

    const pdf = await operations.materials(
      historyQuerySchema.parse({ q: title, status: 'pdf' })
    );

    expect(pdf.items[0]).toMatchObject({
      id: materialId,
      pageCount: 1,
      visibility: 'public',
    });

    for (const row of [...first.items, ...second.items]) {
      expect(row).not.toHaveProperty('content');
      expect(row).not.toHaveProperty('pages');
      expect(row).not.toHaveProperty('memo');
    }
  });

  it('100개 이후 큐 이력도 검색·페이지·필터 전체 집계에 포함하고 상태·기간을 서버에서 적용한다', async () => {
    const prefix = `큐검수-${randomUUID()}`;
    const videoIds = Array.from({ length: 103 }, () => randomUUID());

    await db.manager.insert(
      Video,
      videoIds.map((id, index) => ({
        id,
        ownerId: owner,
        title: `${prefix}${index === 102 ? '-과거%문자' : ''}`,
        youtubeId: id,
        visibility: 'private' as const,
      }))
    );

    try {
      await db.manager.insert(
        Job,
        videoIds.map((id, index) => ({
          videoId: id,
          status: index >= 101 ? 'failed' : index === 100 ? 'ready' : 'queued',
          createdAt: new Date(
            Date.now() - (index === 102 ? 40 * 86_400_000 : index * 1000)
          ),
          updatedAt: new Date(Date.now() - index * 1000),
        }))
      );

      const last = await operations.usage(
        processingUsageQuerySchema.parse({ q: prefix, page: 6, limit: 20 })
      );

      expect(last.total).toBe(103);
      expect(last.items).toHaveLength(3);
      expect(last.hasMore).toBe(false);

      expect(last.summary).toEqual({
        total: 103,
        completed: 1,
        failed: 2,
        processing: 100,
      });

      const failed = await operations.usage(
        processingUsageQuerySchema.parse({
          q: prefix,
          status: 'failed',
          period: '7',
          limit: 1,
        })
      );

      expect(failed.total).toBe(1);

      expect(failed.summary).toEqual({
        total: 1,
        completed: 0,
        failed: 1,
        processing: 0,
      });

      const old = await operations.usage(
        processingUsageQuerySchema.parse({ q: `${prefix}-과거%문자` })
      );

      expect(old.total).toBe(1);
      expect(old.items[0].videoId).toBe(videoIds[102]);

      const byId = await operations.usage(
        processingUsageQuerySchema.parse({ q: old.items[0].id })
      );

      expect(byId.total).toBe(1);
    } finally {
      await db.manager.delete(Video, { id: In(videoIds) });
    }
  });

  it('게시물 신고를 숨김·복원하며 원본과 운영 이력을 남기고 낡은 조치를 거부한다', async () => {
    const title = `게시물검수-${owner}`;

    const posts: { id: string }[] = await db.query(
      `INSERT INTO "CommunityPost"("ownerId",title,body,language,visibility) VALUES($1,$2,'게시한 내용','en','public') RETURNING id`,
      [owner, title]
    );

    const postId = posts[0].id;

    const reports: { id: string }[] = await db.query(
      `INSERT INTO "CommunityReport"("postId","reporterId",reason) VALUES($1,$2,'신고 근거') RETURNING id`,
      [postId, helper]
    );

    const reportId = reports[0].id;
    const community = new CommunityService(db, new SourceService(db));

    const original = await operations.communityReports(
      historyQuerySchema.parse({ q: title })
    );

    expect(original.total).toBe(1);
    expect(original.items[0].post.body).toBe('게시한 내용');
    const expectedUpdatedAt = original.items[0].updatedAt.toISOString();

    await operations.moderate(owner, reportId, {
      status: 'resolved',
      resolution: '게시 내용 숨김',
      hidden: true,
      expectedUpdatedAt,
    });

    await expect(community.get(helper, postId)).rejects.toMatchObject({
      status: 404,
    });

    expect((await community.get(owner, postId)).body).toBe('게시한 내용');

    await expect(
      operations.moderate(owner, reportId, {
        status: 'dismissed',
        resolution: '낡은 상태에서 변경',
        hidden: false,
        expectedUpdatedAt,
      })
    ).rejects.toMatchObject({ status: 409 });

    const refreshed = await operations.communityReports(
      historyQuerySchema.parse({ q: title })
    );

    await operations.moderate(owner, reportId, {
      status: 'dismissed',
      resolution: '근거 재확인 후 복원',
      hidden: false,
      expectedUpdatedAt: refreshed.items[0].updatedAt.toISOString(),
    });

    expect((await community.get(helper, postId)).body).toBe('게시한 내용');

    const events = await db.manager.findBy(ReviewEvent, {
      actorId: owner,
      action: 'community_moderated',
    });

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.visibility === 'internal')).toBe(true);
  });
});
