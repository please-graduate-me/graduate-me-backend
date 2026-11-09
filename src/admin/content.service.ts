import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { z } from 'zod';
import { WorkspaceAccessService } from './workspace-access.service.js';
import { WorkspaceQuestionsService } from './workspace-questions.service.js';
import { QuestionsService } from '../learning/questions.service.js';
import { LearningQuestion } from '../database/entities/LearningQuestion.entity.js';
import { LearningArtifact } from '../database/entities/LearningArtifact.entity.js';
import { ArtifactRevision } from '../database/entities/ArtifactRevision.entity.js';
import { SourceRevision } from '../database/entities/SourceRevision.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { Material } from '../database/entities/Material.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import { User } from '../database/entities/User.entity.js';
import { ExerciseAttempt } from '../database/entities/ExerciseAttempt.entity.js';
import { ReviewRequest } from '../database/entities/ReviewRequest.entity.js';
import { ArtifactService } from '../ai/artifact.service.js';
import { validateCitations } from '../ai/learning-ai.service.js';
import {
  explanationPayloadSchema,
  practicePayloadSchema,
  type revisionInputSchema,
  type contentReviewSchema,
  type visibilityInputSchema,
} from '../ai/contracts.js';
import { learningUnits } from '../videos/grading.js';
import { normalizedExcerpt } from '../learning/source.service.js';
import { HttpError } from '../common/http-error.js';

const segmentPayloadSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
  translation: z.string().max(10000).nullable(),
  blankCandidates: z.array(z.number().int().nonnegative()).max(2000).nullable(),
});

type ContentKind = 'explanation' | 'practice' | 'segment';

@Injectable()
/** 공유된 대상의 실제 수정·검토를 버전별 기록과 영향 표시로 연결한다. */
export class ContentService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(WorkspaceAccessService)
    private readonly access: WorkspaceAccessService,
    @Inject(WorkspaceQuestionsService)
    private readonly questions: WorkspaceQuestionsService,
    @Inject(QuestionsService) private readonly events: QuestionsService,
    @Inject(ArtifactService) private readonly artifacts: ArtifactService
  ) {}
  private kind(kind: string): ContentKind {
    if (!['explanation', 'practice', 'segment'].includes(kind))
      throw new HttpError(400, '수정 대상 종류를 확인해 주세요.');

    return kind as ContentKind;
  }
  private async scope(
    userId: string,
    questionId: string,
    kind: string,
    id: string,
    edit = false
  ) {
    this.kind(kind);
    await this.questions.detail(userId, questionId);

    const question = await this.db.manager.findOneByOrFail(LearningQuestion, {
      id: questionId,
    });

    const access = await this.access.require(userId);

    if (edit && (!access.canEdit || !access.canReview))
      throw new HttpError(403, '자료 수정과 검토 권한이 필요합니다.');
    if (kind === 'segment') {
      if (question.source.kind !== 'video' || question.source.segmentId !== id)
        throw new HttpError(404, '질문에서 공유한 원문만 확인할 수 있습니다.');
    } else if (
      question.attachment?.artifactId !== id ||
      question.attachment.kind !== kind
    )
      throw new HttpError(
        404,
        '질문에서 공유한 설명·문항만 확인할 수 있습니다.'
      );

    return { question, access };
  }
  private async segmentDTO(id: string, question: LearningQuestion) {
    const s = await this.db.manager.findOneBy(Segment, { id });

    if (!s) throw new HttpError(404, '원문 구절을 찾을 수 없습니다.');

    const revision = await this.db.manager.findOneBy(SourceRevision, {
      segmentId: id,
      version: s.version,
    });

    return {
      id,
      kind: 'segment' as const,
      version: s.version,
      status: 'ready',
      reviewStatus: revision?.reviewStatus ?? 'unreviewed',
      needsReview: revision?.reviewStatus === 'needs_review',
      source: {
        ...question.source,
        quote: s.text,
        version: s.version,
        start: s.start,
        end: s.end,
      },
      payload: {
        text: s.text,
        start: s.start,
        end: s.end,
        translation: s.translation,
        blankCandidates: s.blankCandidates,
      },
      units: learningUnits(s.text, question.source.language),
      model: 'human/source',
      provider: 'source',
      createdAt: revision?.createdAt ?? null,
      updatedAt: revision?.createdAt ?? null,
    };
  }
  async list(userId: string, questionId: string) {
    const question = await this.questions.detail(userId, questionId),
      row = await this.db.manager.findOneByOrFail(LearningQuestion, {
        id: questionId,
      });

    const items: Record<string, unknown>[] = [];

    if (question.source.kind === 'video')
      items.push(await this.segmentDTO(question.source.segmentId, row));

    if (
      row.attachment?.artifactId &&
      ['explanation', 'practice'].includes(String(row.attachment.kind))
    ) {
      const a = await this.db.manager.findOneBy(LearningArtifact, {
        id: String(row.attachment.artifactId),
      });

      if (a) items.push(await this.artifacts.dto(a));
    }

    return { items };
  }
  async versions(userId: string, kind: string, id: string, questionId: string) {
    const { question } = await this.scope(userId, questionId, kind, id);

    if (kind === 'segment') {
      const rows = await this.db.manager.find(SourceRevision, {
        where: { segmentId: id },
        order: { version: 'DESC' },
      });

      if (!rows.length) {
        const dto = await this.segmentDTO(id, question);

        return {
          items: [
            {
              version: dto.version,
              payload: dto.payload,
              reason: '최초 전사',
              actor: { id: null, name: 'Gemini' },
              createdAt: null,
              reviewStatus: 'unreviewed',
              status: 'ready',
            },
          ],
        };
      }

      return {
        items: rows.map((r) => ({
          version: r.version,
          payload: r.payload,
          reason: r.reason,
          actor: { id: r.actorId, name: r.actorName },
          createdAt: r.createdAt,
          reviewStatus: r.reviewStatus,
          status: 'ready',
        })),
      };
    }

    const rows = await this.db.manager.find(ArtifactRevision, {
      where: { artifactId: id },
      order: { version: 'DESC' },
    });

    return {
      items: rows.map((r) => ({
        version: r.version,
        payload: r.payload,
        reason: r.reason,
        actor: { id: r.actorId, name: r.actorName },
        createdAt: r.createdAt,
        reviewStatus: r.reviewStatus,
        status: r.status,
      })),
    };
  }
  private async invalidate(
    tx: EntityManager,
    kind: ContentKind,
    id: string,
    reason: string
  ) {
    const rows = await tx.find(LearningArtifact);

    for (const a of rows) {
      const depends =
        kind === 'segment'
          ? a.source.kind === 'video' && a.source.segmentId === id
          : a.parentIds.includes(id);

      if (depends)
        await tx.update(
          LearningArtifact,
          { id: a.id },
          { needsReview: true, reviewStatus: 'needs_review' }
        );
    }

    const reviews = await tx.find(ReviewRequest, { where: { status: 'open' } });

    for (const r of reviews)
      if (r.target?.id === id && r.target.kind === kind)
        await tx.update(
          ReviewRequest,
          { id: r.id },
          { resolution: `대상의 새 버전이 생성되었습니다. ${reason}` }
        );
  }
  private async currentSourceChanged(row: LearningArtifact) {
    if (row.source.kind === 'video') {
      const s = await this.db.manager.findOneBy(Segment, {
        id: row.source.segmentId,
      });

      return !s || s.version !== (row.source.version ?? 1);
    }

    const material =
      row.source.kind === 'pdf'
        ? await this.db.manager.findOne(Material, {
            where: { id: row.source.materialId },
            select: { id: true, version: true },
          })
        : null;

    return !material || material.version !== (row.source.version ?? 1);
  }
  async revise(
    userId: string,
    kind: string,
    id: string,
    input: z.infer<typeof revisionInputSchema>
  ) {
    const targetKind = this.kind(kind),
      { question } = await this.scope(userId, input.questionId, kind, id, true);

    const actor = await this.db.manager.findOneBy(User, { id: userId });

    await this.db.transaction(async (tx) => {
      if (targetKind === 'segment') {
        const row = await tx.findOne(Segment, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });

        if (!row) throw new HttpError(404, '원문을 찾을 수 없습니다.');
        if (row.version !== input.expectedVersion)
          throw new HttpError(
            409,
            '원문이 이미 변경되었습니다. 최신 버전을 확인해 주세요.'
          );

        const payload = segmentPayloadSchema.parse(input.payload),
          video = await tx.findOneByOrFail(Video, { id: row.videoId });

        if (
          payload.end <= payload.start ||
          !video.duration ||
          payload.end > video.duration
        )
          throw new HttpError(
            400,
            '영상 길이 안에서 올바른 구절 시간을 입력해 주세요.'
          );
        const units = learningUnits(payload.text, video.language);

        if (
          payload.blankCandidates &&
          (new Set(payload.blankCandidates).size !==
            payload.blankCandidates.length ||
            payload.blankCandidates.some(
              (n) => n >= units.length || !/[\p{L}\p{N}]/u.test(units[n])
            ))
        )
          throw new HttpError(
            400,
            '원문에 존재하는 서로 다른 빈칸 후보를 선택해 주세요.'
          );

        const neighbors = await tx
          .getRepository(Segment)
          .createQueryBuilder('s')
          .where('s.videoId=:videoId AND (s.index=:before OR s.index=:after)', {
            videoId: row.videoId,
            before: row.index - 1,
            after: row.index + 1,
          })
          .getMany();

        if (
          neighbors.some((n) =>
            n.index < row.index ? n.end > payload.start : n.start < payload.end
          )
        )
          throw new HttpError(400, '앞뒤 구절과 시간이 겹치지 않아야 합니다.');
        if (
          !(await tx.findOneBy(SourceRevision, {
            segmentId: id,
            version: row.version,
          }))
        )
          await tx.save(SourceRevision, {
            segmentId: id,
            version: row.version,
            payload: {
              text: row.text,
              start: row.start,
              end: row.end,
              translation: row.translation,
              blankCandidates: row.blankCandidates,
            },
            actorId: null,
            actorName: 'Gemini',
            reason: '최초 전사',
            reviewStatus: 'unreviewed',
          });

        await tx.update(
          Segment,
          { id },
          { ...payload, version: row.version + 1 }
        );

        await tx.save(SourceRevision, {
          segmentId: id,
          version: row.version + 1,
          payload,
          actorId: userId,
          actorName: actor?.name || '검토자',
          reason: input.reason,
          reviewStatus: 'needs_review',
        });

        await tx.update(
          Progress,
          { videoId: row.videoId },
          { scriptViewed: false }
        );
      } else {
        const row = await tx.findOne(LearningArtifact, {
          where: { id, kind: targetKind },
          lock: { mode: 'pessimistic_write' },
        });

        if (!row) throw new HttpError(404, '학습 결과를 찾을 수 없습니다.');
        if (row.version !== input.expectedVersion)
          throw new HttpError(
            409,
            '다른 수정본이 먼저 저장되었습니다. 최신 버전을 확인해 주세요.'
          );

        const priorRevision =
          targetKind === 'explanation'
            ? await this.artifacts.revision(row)
            : null;

        const payload =
          targetKind === 'explanation'
            ? explanationPayloadSchema.parse(input.payload)
            : practicePayloadSchema.parse(input.payload);

        if (targetKind === 'explanation')
          validateCitations(
            explanationPayloadSchema.parse(payload),
            row.source
          );
        else if (
          !normalizedExcerpt(row.source.quote).includes(
            normalizedExcerpt(practicePayloadSchema.parse(payload).sourceQuote)
          )
        )
          throw new HttpError(
            400,
            '문항 근거가 선택 원문에 존재하지 않습니다.'
          );

        await tx.save(ArtifactRevision, {
          artifactId: id,
          version: row.version + 1,
          payload: {
            ...payload,
            ...(priorRevision
              ? {
                  contextDescription: priorRevision.payload.contextDescription,
                  evidenceType: priorRevision.payload.evidenceType,
                }
              : {}),
          },
          actorId: userId,
          actorName: actor?.name || '검토자',
          reason: input.reason,
          reviewStatus: 'needs_review',
          status: row.status,
        });

        await tx.update(
          LearningArtifact,
          { id },
          {
            version: row.version + 1,
            reviewStatus: 'needs_review',
            needsReview: true,
          }
        );
      }

      await this.invalidate(tx, targetKind, id, input.reason);

      await this.events.event(
        tx,
        userId,
        input.questionId,
        'content_revised',
        `${kind} ${id} v${input.expectedVersion} 수정: ${input.reason}`,
        'public'
      );
    });

    return targetKind === 'segment'
      ? this.segmentDTO(id, question)
      : this.artifacts.dto(
          await this.db.manager.findOneByOrFail(LearningArtifact, { id })
        );
  }
  async review(
    userId: string,
    kind: string,
    id: string,
    input: z.infer<typeof contentReviewSchema>
  ) {
    const { question, access } = await this.scope(
      userId,
      input.questionId,
      kind,
      id
    );

    if (!access.canReview) throw new HttpError(403, '검토 권한이 필요합니다.');

    await this.db.transaction(async (tx) => {
      if (kind === 'segment') {
        const s = await tx.findOneOrFail(Segment, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });

        if (
          s.version !== input.version &&
          !(await tx.findOneBy(SourceRevision, {
            segmentId: id,
            version: input.version,
          }))
        )
          throw new HttpError(404, '검토할 원문 버전을 찾을 수 없습니다.');

        const old = await tx.findOneBy(SourceRevision, {
          segmentId: id,
          version: input.version,
        });

        if (old)
          await tx.update(
            SourceRevision,
            { id: old.id },
            { reviewStatus: input.status }
          );
        else
          await tx.save(SourceRevision, {
            segmentId: id,
            version: input.version,
            payload: {
              text: s.text,
              start: s.start,
              end: s.end,
              translation: s.translation,
              blankCandidates: s.blankCandidates,
            },
            actorId: null,
            actorName: 'Gemini',
            reason: '최초 전사',
            reviewStatus: input.status,
          });
      } else {
        const row = await tx.findOneOrFail(LearningArtifact, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });

        if (
          !(await tx.findOneBy(ArtifactRevision, {
            artifactId: id,
            version: input.version,
          }))
        )
          throw new HttpError(404, '검토할 결과 버전을 찾을 수 없습니다.');

        await tx.update(
          ArtifactRevision,
          { artifactId: id, version: input.version },
          { reviewStatus: input.status }
        );

        if (row.version === input.version)
          await tx.update(
            LearningArtifact,
            { id, version: input.version },
            {
              reviewStatus: input.status,
              needsReview:
                input.status === 'needs_review' ||
                (await this.currentSourceChanged(row)),
            }
          );
      }

      await this.events.event(
        tx,
        userId,
        input.questionId,
        'content_reviewed',
        `${kind} v${input.version} ${input.status}: ${input.reason}`,
        'public'
      );
    });

    return kind === 'segment'
      ? this.segmentDTO(id, question)
      : this.artifacts.dto(
          await this.db.manager.findOneByOrFail(LearningArtifact, { id })
        );
  }
  async visibility(
    userId: string,
    id: string,
    input: z.infer<typeof visibilityInputSchema>
  ) {
    await this.scope(userId, input.questionId, 'practice', id, true);

    await this.db.transaction(async (tx) => {
      const row = await tx.findOne(LearningArtifact, {
        where: { id, kind: 'practice' },
        lock: { mode: 'pessimistic_write' },
      });

      if (!row || row.version !== input.version)
        throw new HttpError(409, '현재 문항 버전을 확인해 주세요.');

      await tx.update(
        LearningArtifact,
        { id },
        { status: input.visible ? 'ready' : 'suspended' }
      );

      await tx.update(
        ArtifactRevision,
        { artifactId: id, version: input.version },
        { status: input.visible ? 'ready' : 'suspended' }
      );

      await this.events.event(
        tx,
        userId,
        input.questionId,
        'practice_visibility_changed',
        `${input.visible ? '노출 재개' : '노출 중단'}: ${input.reason}`,
        'public'
      );
    });

    return this.artifacts.dto(
      await this.db.manager.findOneByOrFail(LearningArtifact, { id })
    );
  }
  async impact(userId: string, kind: string, id: string, questionId: string) {
    const { question } = await this.scope(userId, questionId, kind, id);
    const all = await this.db.manager.find(LearningArtifact);

    const relevant = all.filter(
      (a) =>
        a.ownerId === question.ownerId &&
        (kind === 'segment'
          ? a.source.kind === 'video' && a.source.segmentId === id
          : a.parentIds.includes(id))
    );

    const attemptCount =
      kind === 'practice'
        ? await this.db.manager.count(ExerciseAttempt, {
            where: { artifactId: id },
          })
        : 0;

    return {
      items: relevant.map((a) => ({
        id: a.id,
        kind: a.kind,
        version: a.version,
        status: a.status,
        reviewStatus: a.reviewStatus,
        needsReview: a.needsReview,
      })),
      attemptCount,
    };
  }
}
