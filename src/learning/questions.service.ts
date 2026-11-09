import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { Material } from '../database/entities/Material.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import type { z } from 'zod';
import { LearningQuestion } from '../database/entities/LearningQuestion.entity.js';
import { QuestionMessage } from '../database/entities/QuestionMessage.entity.js';
import { HelperProfile } from '../database/entities/HelperProfile.entity.js';
import { ReviewEvent } from '../database/entities/ReviewEvent.entity.js';
import { User } from '../database/entities/User.entity.js';
import {
  WorkspaceAccessService,
  helperCanAccess,
} from '../admin/workspace-access.service.js';
import { SourceService } from './source.service.js';
import { HttpError } from '../common/http-error.js';
import { readableMaterial } from './access.js';
import { requireReadableVideo } from '../videos/access.js';
import type {
  LearningSource,
  questionInputSchema,
  recipientsQuerySchema,
} from './contracts.js';

@Injectable()
/** 학생 응답은 명시한 필드만 직렬화해 내부 초안과 메모가 섞이지 않게 한다. */
export class QuestionsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(SourceService) private readonly sources: SourceService,
    @Inject(WorkspaceAccessService)
    private readonly access: WorkspaceAccessService
  ) {}
  async summary(row: LearningQuestion) {
    const [author, assignee] = await Promise.all([
      this.db.manager.findOneBy(User, { id: row.ownerId }),
      row.assigneeId
        ? this.db.manager.findOneBy(User, { id: row.assigneeId })
        : null,
    ]);

    return {
      id: row.id,
      title: row.title,
      body: row.body,
      status: row.status,
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
      author: { id: row.ownerId, name: author?.name ?? null },
    };
  }
  async detail(row: LearningQuestion) {
    const messages = await this.db.manager.find(QuestionMessage, {
      where: { questionId: row.id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    return {
      ...(await this.summary(row)),
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        author: { id: m.authorId, name: m.authorName },
        kind: m.kind,
        createdAt: m.createdAt,
      })),
    };
  }
  async list(userId: string) {
    const rows = await this.db.manager.find(LearningQuestion, {
      where: { ownerId: userId },
      order: { updatedAt: 'DESC' },
    });

    return { items: await Promise.all(rows.map((row) => this.summary(row))) };
  }
  async owned(userId: string, id: string) {
    const row = await this.db.manager.findOneBy(LearningQuestion, {
      id,
      ownerId: userId,
    });

    if (!row) throw new HttpError(404, '질문을 찾을 수 없습니다.');

    return row;
  }
  async get(userId: string, id: string) {
    return this.detail(await this.owned(userId, id));
  }
  async event(
    tx: EntityManager,
    userId: string,
    questionId: string | null,
    action: string,
    detail: string,
    visibility: 'public' | 'internal' = 'internal'
  ) {
    const user = await tx.findOneBy(User, { id: userId });

    await tx.insert(ReviewEvent, {
      questionId,
      actorId: userId,
      actorName: user?.name || '이름 없는 사용자',
      action,
      detail,
      visibility,
    });
  }
  async create(userId: string, input: z.infer<typeof questionInputSchema>) {
    const source = await this.sources.resolve(userId, input.source);

    if (
      input.assigneeId &&
      !(await this.access.canAssign(input.assigneeId, source))
    )
      throw new HttpError(403, '이 자료를 담당하는 도우미를 선택해 주세요.');

    const row = await this.db.transaction(async (tx) => {
      const question = await tx.save(LearningQuestion, {
        ownerId: userId,
        title: input.title,
        body: input.body,
        source,
        assigneeId: input.assigneeId ?? null,
        status: 'waiting',
        draft: '',
        internalNote: '',
      });

      await this.event(
        tx,
        userId,
        question.id,
        'question_created',
        input.assigneeId
          ? '담당 도우미에게 질문을 보냈습니다.'
          : '운영자에게 질문을 접수했습니다.',
        'public'
      );

      return question;
    });

    return this.detail(row);
  }
  async followUp(userId: string, id: string, body: string) {
    await this.db.transaction(async (tx) => {
      const question = await tx.findOne(LearningQuestion, {
        where: { id, ownerId: userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!question) throw new HttpError(404, '질문을 찾을 수 없습니다.');
      const user = await tx.findOneBy(User, { id: userId });

      await tx.insert(QuestionMessage, {
        questionId: id,
        authorId: userId,
        authorName: user?.name || '질문자',
        body,
        kind: 'question',
      });

      await tx.update(LearningQuestion, { id }, { status: 'waiting' });

      await this.event(
        tx,
        userId,
        id,
        'question_follow_up',
        '추가 질문을 보냈습니다.',
        'public'
      );
    });

    return this.get(userId, id);
  }
  async recipients(
    userId: string,
    query: z.infer<typeof recipientsQuerySchema>
  ) {
    if (!query.materialId) return { items: [] };

    const material = await this.db.manager.findOneBy(Material, {
      id: query.materialId,
    });

    let source: LearningSource;

    if (material) {
      await readableMaterial(this.db, userId, material.id);

      source = {
        kind: 'pdf',
        materialId: material.id,
        page: 1,
        quote: '',
        title: material.title,
        language: material.language,
      };
    } else {
      const progress = await this.db.manager.findOneBy(Progress, {
        userId,
        videoId: query.materialId,
        archivedAt: IsNull(),
      });

      if (!progress) throw new HttpError(404, '자료를 찾을 수 없습니다.');

      const video = await requireReadableVideo(
        this.db,
        userId,
        query.materialId
      );

      source = {
        kind: 'video',
        videoId: video.id,
        segmentId: '',
        quote: '',
        title: video.title,
        language: video.language,
      };
    }

    if (query.language !== source.language)
      throw new HttpError(400, '원문 언어를 확인해 주세요.');

    const profiles = await this.db.manager.find(HelperProfile, {
      where: { active: true },
    });

    const items = await Promise.all(
      profiles
        .filter((p) => helperCanAccess(p, source))
        .map(async (p) => {
          const user = await this.db.manager.findOneBy(User, { id: p.userId });

          return {
            id: p.userId,
            name: user?.name ?? null,
            languages: p.languages,
          };
        })
    );

    return { items };
  }
}
