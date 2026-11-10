import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { z } from 'zod';
import { LearningQuestion } from '../database/entities/LearningQuestion.entity.js';
import { QuestionMessage } from '../database/entities/QuestionMessage.entity.js';
import { ReviewRequest } from '../database/entities/ReviewRequest.entity.js';
import { ReviewEvent } from '../database/entities/ReviewEvent.entity.js';
import { ArtifactRevision } from '../database/entities/ArtifactRevision.entity.js';
import { SourceRevision } from '../database/entities/SourceRevision.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { User } from '../database/entities/User.entity.js';
import { QuestionsService } from '../learning/questions.service.js';
import { HttpError } from '../common/http-error.js';
import { containsPattern } from '../database/query.js';
import {
  WorkspaceAccessService,
  helperCanAccess,
} from './workspace-access.service.js';
import type { WorkspaceQuery } from '../learning/contracts.js';
import type {
  draftInputSchema,
  reviewInputSchema,
  resolutionInputSchema,
  QuestionListQuery,
  HistoryQuery,
} from './workspace-contracts.js';

/** 검토 요청에서도 계정 식별자와 내부 저장 필드를 명시적으로 투영한다. */
export function reviewDetail(r: ReviewRequest) {
  return {
    id: r.id,
    questionId: r.questionId,
    scope: r.scope,
    version: r.version,
    reason: r.reason,
    status: r.status,
    resolution: r.resolution,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    author: { id: r.authorId, name: r.authorName },
    source: r.source,
    target: r.target,
    kind: r.kind,
  };
}

/** 답변·내부 메모·검토를 배정된 질문의 현재 권한 안에서 처리한다. */
@Injectable()
export class WorkspaceQuestionsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(WorkspaceAccessService)
    private readonly access: WorkspaceAccessService,
    @Inject(QuestionsService) private readonly questions: QuestionsService
  ) {}
  private async scoped(userId: string) {
    const access = await this.access.require(userId);

    const builder = this.db
      .getRepository(LearningQuestion)
      .createQueryBuilder('q');

    if (access.role !== 'admin') {
      // 과거 배정이 남아 있어도 현재 언어·자료 권한을 잃은 질문은 목록에서 숨긴다.
      builder.where('q.assigneeId = :userId AND q.revokedAt IS NULL', {
        userId,
      });

      if (!access.languages.length || !access.materialIds.length)
        builder.andWhere('false');
      else
        builder
          .andWhere("q.source->>'language' IN (:...languages)", {
            languages: access.languages,
          })
          .andWhere(
            "COALESCE(q.source->>'materialId', q.source->>'videoId') IN (:...materialIds)",
            { materialIds: access.materialIds }
          );
    }

    return builder;
  }
  private async readable(userId: string, id: string, tx?: EntityManager) {
    // 변경 요청에서는 같은 질문의 배정·공유 상태를 잠가 권한 판정 뒤 덮어쓰기를 막는다.
    const row = tx
      ? await tx.findOne(LearningQuestion, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        })
      : await this.db.manager.findOneBy(LearningQuestion, { id });

    if (!row) throw new HttpError(404, '질문을 찾을 수 없습니다.');
    const access = await this.access.require(userId);

    if (
      access.role !== 'admin' &&
      (Boolean(row.revokedAt) ||
        row.assigneeId !== userId ||
        !helperCanAccess(await this.access.profile(userId), row.source))
    )
      throw new HttpError(404, '질문을 찾을 수 없습니다.');

    return row;
  }
  async detail(userId: string, id: string) {
    const row = await this.readable(userId, id);

    const reviews = await this.db.manager.find(ReviewRequest, {
      where: { questionId: id },
      order: { createdAt: 'DESC' },
    });

    return {
      ...(await this.questions.detail(row)),
      draft: row.draft,
      internalNote: row.internalNote,
      reviews: reviews.map(reviewDetail),
    };
  }
  async list(
    userId: string,
    query: WorkspaceQuery & Partial<QuestionListQuery>
  ) {
    const builder = await this.scoped(userId);

    if (query.q)
      builder.andWhere(
        '(q.title ILIKE :term OR q.body ILIKE :term OR q.id ILIKE :term)',
        {
          term: containsPattern(query.q),
        }
      );

    if (query.period && query.period !== 'all')
      builder.andWhere('q.createdAt >= :since', {
        since: new Date(Date.now() - Number(query.period) * 86_400_000),
      });

    const reviewCondition = `EXISTS (SELECT 1 FROM "ReviewRequest" review WHERE review."questionId" = q.id AND review.status = 'open')`;

    // 상태 탭을 바꾸어도 검색 범위의 집계가 현재 페이지 수로 바뀌지 않게 한다.
    const [all, waiting, answered, review] = await Promise.all([
      builder.clone().getCount(),
      builder
        .clone()
        .andWhere('q.status = :status', { status: 'waiting' })
        .getCount(),
      builder
        .clone()
        .andWhere('q.status = :status', { status: 'answered' })
        .getCount(),
      builder.clone().andWhere(reviewCondition).getCount(),
    ]);

    if (query.status === 'review') builder.andWhere(reviewCondition);
    else if (query.status === 'waiting' || query.status === 'answered')
      builder.andWhere('q.status = :status', { status: query.status });

    const [rows, total] = await builder
      .orderBy('q.updatedAt', 'DESC')
      .addOrderBy('q.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return {
      items: await Promise.all(rows.map((row) => this.questions.summary(row))),
      page: query.page,
      limit: query.limit,
      total,
      hasMore: query.page * query.limit < total,
      summary: { all, waiting, answered, review },
    };
  }
  async saveDraft(
    userId: string,
    id: string,
    input: z.infer<typeof draftInputSchema>
  ) {
    const access = await this.access.require(userId);

    if (input.internalNote !== undefined && !access.canReview)
      throw new HttpError(403, '내부 검토 권한이 필요합니다.');

    await this.db.transaction(async (tx) => {
      await this.readable(userId, id, tx);
      if (!Object.keys(input).length) return;
      await tx.update(LearningQuestion, { id }, input);

      await this.questions.event(
        tx,
        userId,
        id,
        'draft_saved',
        input.internalNote !== undefined
          ? '내부 검토 메모와 초안을 저장했습니다.'
          : '답변 초안을 저장했습니다.'
      );
    });

    return this.detail(userId, id);
  }
  async answer(userId: string, id: string, body: string) {
    await this.db.transaction(async (tx) => {
      await this.readable(userId, id, tx);
      const user = await tx.findOneBy(User, { id: userId });

      await tx.insert(QuestionMessage, {
        questionId: id,
        authorId: userId,
        authorName: user?.name || '답변 도우미',
        body,
        kind: 'answer',
      });

      await tx.update(
        LearningQuestion,
        { id },
        { draft: '', status: 'answered' }
      );

      await this.questions.event(
        tx,
        userId,
        id,
        'answer_published',
        '학생에게 공개 답변을 게시했습니다.',
        'public'
      );
    });

    return this.detail(userId, id);
  }
  async assign(userId: string, id: string, assigneeId: string | null) {
    await this.db.transaction(async (tx) => {
      const row = await this.readable(userId, id, tx);

      if (assigneeId && !(await this.access.canAssign(assigneeId, row.source)))
        throw new HttpError(
          400,
          '이 자료와 언어에 접근할 수 있는 도우미를 선택해 주세요.'
        );
      await tx.update(LearningQuestion, { id }, { assigneeId });

      await this.questions.event(
        tx,
        userId,
        id,
        'assignment_changed',
        assigneeId
          ? `담당 도우미를 ${assigneeId} 계정으로 변경했습니다.`
          : '담당 도우미 배정을 해제했습니다.'
      );
    });

    return this.detail(userId, id);
  }
  async requestReview(
    userId: string,
    id: string,
    input: z.infer<typeof reviewInputSchema>
  ) {
    const access = await this.access.require(userId);

    if (!access.canReview || !access.canRequestEdit)
      throw new HttpError(403, '검토와 수정 요청 권한이 필요합니다.');

    await this.db.transaction(async (tx) => {
      const row = await this.readable(userId, id, tx);
      const user = await tx.findOneBy(User, { id: userId });
      const target = input.target;

      if (target) {
        const expectedScope =
          target.kind === 'segment'
            ? 'source'
            : target.kind === 'practice'
              ? 'question'
              : 'explanation';

        const shared =
          target.kind === 'segment'
            ? row.source.kind === 'video' && row.source.segmentId === target.id
            : row.attachment?.artifactId === target.id &&
              row.attachment.kind === target.kind;

        if (!shared || input.scope !== expectedScope)
          throw new HttpError(
            404,
            '질문에 공유한 대상과 검토 범위를 확인해 주세요.'
          );

        const versionExists =
          target.kind === 'segment'
            ? (await tx.existsBy(Segment, {
                id: target.id,
                version: target.version,
              })) ||
              (await tx.existsBy(SourceRevision, {
                segmentId: target.id,
                version: target.version,
              }))
            : await tx.existsBy(ArtifactRevision, {
                artifactId: target.id,
                version: target.version,
              });

        if (!versionExists)
          throw new HttpError(404, '검토할 대상 버전을 찾을 수 없습니다.');
      }

      await tx.insert(ReviewRequest, {
        questionId: id,
        authorId: userId,
        authorName: user?.name || '답변 도우미',
        source: row.source,
        ...input,
        status: 'open',
        target: input.target ?? null,
        kind: 'review_request',
      });

      await this.questions.event(
        tx,
        userId,
        id,
        'review_requested',
        `${input.scope} · ${input.version}: ${input.reason}`
      );
    });

    return this.detail(userId, id);
  }
  async review(userId: string, id: string) {
    const row = await this.db.manager.findOneBy(ReviewRequest, { id });

    if (!row) throw new HttpError(404, '검토 요청을 찾을 수 없습니다.');
    // 검토 식별자를 알아도 연결 질문의 현재 배정 범위를 우회할 수 없다.
    await this.readable(userId, row.questionId);

    return reviewDetail(row);
  }
  async reviews(userId: string, query?: HistoryQuery) {
    // 질문 ID를 앱으로 넘기지 않고 같은 ACL 하위 쿼리 안에서 이력을 제한한다.
    const scope = (await this.scoped(userId)).select('q.id');

    const builder = this.db
      .getRepository(ReviewRequest)
      .createQueryBuilder('r')
      .where(`r."questionId" IN (${scope.getQuery()})`)
      .setParameters(scope.getParameters());

    const {
      page = 1,
      limit = 100,
      status = 'all',
      period = 'all',
      q = '',
      kind = 'all',
    } = query ?? {};

    if (status !== 'all') builder.andWhere('r.status = :status', { status });
    if (kind !== 'all') builder.andWhere('r.kind = :kind', { kind });
    if (period !== 'all')
      builder.andWhere('r.createdAt >= :since', {
        since: new Date(Date.now() - Number(period) * 86_400_000),
      });
    if (q)
      builder.andWhere(
        `(r.reason ILIKE :term OR r.version ILIKE :term OR r.source->>'title' ILIKE :term OR r.id ILIKE :term)`,
        { term: containsPattern(q) }
      );

    const [rows, total] = await builder
      .orderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items: rows.map(reviewDetail),
      page,
      limit,
      total,
      hasMore: page * limit < total,
    };
  }
  async resolve(
    userId: string,
    id: string,
    input: z.infer<typeof resolutionInputSchema>
  ) {
    const row = await this.db.transaction(async (tx) => {
      const review = await tx.findOne(ReviewRequest, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!review) throw new HttpError(404, '검토 요청을 찾을 수 없습니다.');
      if (review.status !== 'open')
        throw new HttpError(409, '이미 처리된 검토 요청입니다.');
      await tx.update(ReviewRequest, { id }, input);

      await this.questions.event(
        tx,
        userId,
        review.questionId,
        'review_resolved',
        `${review.scope} · ${review.version}: ${input.resolution}`
      );

      return { ...review, ...input };
    });

    return reviewDetail(row);
  }
  async events(userId: string, query?: HistoryQuery) {
    const access = await this.access.require(userId);
    const builder = this.db.getRepository(ReviewEvent).createQueryBuilder('e');

    if (access.role !== 'admin') {
      // 도우미에게는 공통 운영 기록과 타인 질문의 내부 메모도 공개하지 않는다.
      const scope = (await this.scoped(userId)).select('q.id');

      builder
        .where(`e."questionId" IN (${scope.getQuery()})`)
        .setParameters(scope.getParameters());
    }

    const {
      page = 1,
      limit = 100,
      status = 'all',
      period = 'all',
      q = '',
    } = query ?? {};

    if (status !== 'all')
      builder.andWhere('e.visibility = :status', { status });
    if (period !== 'all')
      builder.andWhere('e.createdAt >= :since', {
        since: new Date(Date.now() - Number(period) * 86_400_000),
      });
    if (q)
      builder.andWhere(
        `(e.detail ILIKE :term OR e.action ILIKE :term OR e."actorName" ILIKE :term OR e."questionId" ILIKE :term)`,
        { term: containsPattern(q) }
      );

    const [rows, total] = await builder
      .orderBy('e.createdAt', 'DESC')
      .addOrderBy('e.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items: rows.map((row) => ({
        id: row.id,
        questionId: row.questionId,
        action: row.action,
        detail: row.detail,
        visibility: row.visibility,
        actor: { id: row.actorId, name: row.actorName },
        createdAt: row.createdAt,
      })),
      page,
      limit,
      total,
      hasMore: page * limit < total,
    };
  }
}
