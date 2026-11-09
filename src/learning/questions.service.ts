import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { Material } from '../database/entities/Material.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import type { z } from 'zod';
import { LearningQuestion } from '../database/entities/LearningQuestion.entity.js';
import { QuestionMessage } from '../database/entities/QuestionMessage.entity.js';
import { HelperProfile } from '../database/entities/HelperProfile.entity.js';
import { ReviewEvent } from '../database/entities/ReviewEvent.entity.js';
import { ReviewRequest } from '../database/entities/ReviewRequest.entity.js';
import { LearningArtifact } from '../database/entities/LearningArtifact.entity.js';
import { ArtifactRevision } from '../database/entities/ArtifactRevision.entity.js';
import { AIConversation } from '../database/entities/AIConversation.entity.js';
import { AIMessage } from '../database/entities/AIMessage.entity.js';
import { sameSource } from '../ai/artifact.service.js';
import { normalizedExcerpt } from './source.service.js';
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
      kind: row.kind,
      resolvedAt: row.resolvedAt,
      revokedAt: row.revokedAt,
      attachment: row.attachment,
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
    let attachment: Record<string, unknown> | null = null;

    if (input.attachment) {
      if ('artifactId' in input.attachment) {
        const artifact = await this.db.manager.findOneBy(LearningArtifact, {
          id: input.attachment.artifactId,
          ownerId: userId,
        });

        const revision =
          artifact &&
          (await this.db.manager.findOneBy(ArtifactRevision, {
            artifactId: artifact.id,
            version: input.attachment.version,
          }));

        if (
          !artifact ||
          !revision ||
          !sameSource(source, artifact.source) ||
          normalizedExcerpt(source.quote) !==
            normalizedExcerpt(artifact.source.quote)
        )
          throw new HttpError(
            400,
            '현재 질문에서 명시적으로 선택한 원문의 결과만 공유할 수 있습니다.'
          );
        const payload = { ...revision.payload };

        delete payload.answer;
        delete payload.explanation;
        delete payload.hint;

        // 설명 본문은 선택한 결과만, 문제는 미공개 정답을 제외한 문항만 공유한다.
        const sharedPayload =
          artifact.kind === 'explanation' ? revision.payload : payload;

        attachment = {
          artifactId: artifact.id,
          version: revision.version,
          kind: artifact.kind,
          text:
            artifact.kind === 'explanation'
              ? String(
                  revision.payload.meaning ?? revision.payload.translation ?? ''
                )
              : String(payload.question ?? ''),
          payload: sharedPayload,
        };
      } else {
        const conversation = await this.db.manager.findOneBy(AIConversation, {
          id: input.attachment.conversationId,
          ownerId: userId,
        });

        const message =
          conversation &&
          (await this.db.manager.findOneBy(AIMessage, {
            id: input.attachment.messageId,
            conversationId: conversation.id,
            role: 'assistant',
            status: 'ready',
          }));

        if (
          !conversation ||
          !message ||
          !sameSource(source, conversation.source) ||
          normalizedExcerpt(source.quote) !==
            normalizedExcerpt(conversation.source.quote)
        )
          throw new HttpError(
            400,
            '이 원문에서 선택한 본인의 AI 답변만 공유할 수 있습니다.'
          );

        attachment = {
          kind: 'ai_answer',
          text: message.text,
          model: message.model,
          conversationId: conversation.id,
          messageId: message.id,
        };
      }
    }

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
        kind: input.kind ?? 'question',
        attachment,
      });

      if (input.kind === 'report') {
        const target = attachment?.artifactId
          ? {
              kind: attachment.kind as 'explanation' | 'practice',
              id: String(attachment.artifactId),
              version: Number(attachment.version),
            }
          : source.kind === 'video'
            ? {
                kind: 'segment' as const,
                id: source.segmentId,
                version: source.version ?? 1,
              }
            : null;

        const user = await tx.findOneBy(User, { id: userId });

        await tx.save(ReviewRequest, {
          questionId: question.id,
          authorId: userId,
          authorName: user?.name || '질문자',
          scope:
            target?.kind === 'explanation'
              ? 'explanation'
              : target?.kind === 'practice'
                ? 'question'
                : 'source',
          version: `v${target?.version ?? source.version ?? 1}`,
          reason: input.body,
          source,
          kind: 'report',
          target,
          status: 'open',
        });
      }

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
      if (question.revokedAt)
        throw new HttpError(
          409,
          '공유를 다시 허용한 뒤 추가 질문을 보내 주세요.'
        );
      const user = await tx.findOneBy(User, { id: userId });

      await tx.insert(QuestionMessage, {
        questionId: id,
        authorId: userId,
        authorName: user?.name || '질문자',
        body,
        kind: 'question',
      });

      await tx.update(
        LearningQuestion,
        { id },
        { status: 'waiting', resolvedAt: null }
      );

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
  async updateState(
    userId: string,
    id: string,
    input: { resolved?: boolean; shared?: boolean }
  ) {
    await this.owned(userId, id);
    if (!Object.keys(input).length) return this.get(userId, id);

    await this.db.manager.update(
      LearningQuestion,
      { id, ownerId: userId },
      {
        ...(input.resolved !== undefined
          ? { resolvedAt: input.resolved ? new Date() : null }
          : {}),
        ...(input.shared !== undefined
          ? { revokedAt: input.shared ? null : new Date() }
          : {}),
      }
    );

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
