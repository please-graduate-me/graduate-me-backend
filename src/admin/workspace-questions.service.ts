import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, type EntityManager } from 'typeorm';
import type { z } from 'zod';
import { LearningQuestion } from '../database/entities/LearningQuestion.entity.js';
import { QuestionMessage } from '../database/entities/QuestionMessage.entity.js';
import { ReviewRequest } from '../database/entities/ReviewRequest.entity.js';
import { ReviewEvent } from '../database/entities/ReviewEvent.entity.js';
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
  };
}

@Injectable()
/** 답변·내부 메모·검토를 배정된 질문의 현재 권한 안에서 처리한다. */
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
      builder.where('q.assigneeId = :userId', { userId });
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
      (row.assigneeId !== userId ||
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
  async list(userId: string, query: WorkspaceQuery) {
    const builder = await this.scoped(userId);

    if (query.q)
      builder.andWhere(
        '(q.title ILIKE :term OR q.body ILIKE :term OR q.id ILIKE :term)',
        {
          term: containsPattern(query.q),
        }
      );

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

      await tx.insert(ReviewRequest, {
        questionId: id,
        authorId: userId,
        authorName: user?.name || '답변 도우미',
        source: row.source,
        ...input,
        status: 'open',
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
  async reviews(userId: string) {
    const ids = (
      await (await this.scoped(userId)).select('q.id').getMany()
    ).map((q) => q.id);

    if (!ids.length) return { items: [] };

    const rows = await this.db.manager.find(ReviewRequest, {
      where: { questionId: In(ids) },
      order: { createdAt: 'DESC', id: 'ASC' },
      take: 100,
    });

    return { items: rows.map(reviewDetail) };
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
  async events(userId: string) {
    const access = await this.access.require(userId);

    const ids = (
      await (await this.scoped(userId)).select('q.id').getMany()
    ).map((q) => q.id);

    if (access.role !== 'admin' && !ids.length) return { items: [] };

    const rows = await this.db.manager.find(ReviewEvent, {
      ...(access.role === 'admin' ? {} : { where: { questionId: In(ids) } }),
      order: { createdAt: 'DESC', id: 'ASC' },
      take: 100,
    });

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
    };
  }
}
