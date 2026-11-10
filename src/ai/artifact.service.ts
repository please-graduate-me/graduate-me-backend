import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { LearningArtifact } from '../database/entities/LearningArtifact.entity.js';
import { ArtifactRevision } from '../database/entities/ArtifactRevision.entity.js';
import { ExerciseState } from '../database/entities/ExerciseState.entity.js';
import { ExerciseAttempt } from '../database/entities/ExerciseAttempt.entity.js';
import { HttpError } from '../common/http-error.js';
import type { LearningSource } from '../learning/contracts.js';
import type { SourceQuery } from './contracts.js';

/** 원문 식별자와 선택 위치·버전이 같은지 확인한다. */
export function sameSource(a: LearningSource, b: LearningSource) {
  return (
    a.kind === b.kind &&
    (a.kind === 'pdf' && b.kind === 'pdf'
      ? a.materialId === b.materialId &&
        a.page === b.page &&
        (a.ocrId ?? null) === (b.ocrId ?? null)
      : a.kind === 'video' &&
        b.kind === 'video' &&
        a.videoId === b.videoId &&
        a.segmentId === b.segmentId) &&
    (a.version ?? 1) === (b.version ?? 1)
  );
}

/** 과거 답안의 당시 정답과 근거만 공개한다. */
export function exerciseResult(row: ExerciseAttempt) {
  return {
    id: row.id,
    artifactId: row.artifactId,
    version: row.version,
    answer: row.answer,
    correct: row.correct,
    expectedAnswer: row.expectedAnswer,
    explanation: row.explanation,
    feedback: row.feedback,
    hintUsed: row.hintUsed,
    revealed: row.revealed,
    source: row.source,
    createdAt: row.createdAt,
  };
}

/** 불변 수정본과 현재 표시 상태를 분리하고 정답 필드를 서버에 남긴다. */
@Injectable()
export class ArtifactService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async owned(ownerId: string, id: string) {
    const row = await this.db.manager.findOneBy(LearningArtifact, {
      id,
      ownerId,
    });

    if (!row) throw new HttpError(404, '저장한 학습 결과를 찾을 수 없습니다.');

    return row;
  }
  async revision(row: LearningArtifact, version = row.version) {
    const r = await this.db.manager.findOneBy(ArtifactRevision, {
      artifactId: row.id,
      version,
    });

    if (!r) throw new HttpError(404, '해당 버전을 찾을 수 없습니다.');

    return r;
  }
  async create(
    tx: EntityManager,
    input: {
      ownerId: string;
      kind: 'explanation' | 'practice';
      source: LearningSource;
      payload: Record<string, unknown>;
      model: string;
      provider: string;
      cacheKey?: string;
      expressionIds?: string[];
      parentIds?: string[];
      batchId?: string;
    }
  ) {
    const row = await tx.save(LearningArtifact, {
      ownerId: input.ownerId,
      kind: input.kind,
      source: input.source,
      model: input.model,
      provider: input.provider,
      version: 1,
      status: 'ready',
      reviewStatus: 'unreviewed',
      needsReview: false,
      cacheKey: input.cacheKey ?? null,
      expressionIds: input.expressionIds ?? [],
      parentIds: input.parentIds ?? [],
      batchId: input.batchId ?? null,
    });

    await tx.save(ArtifactRevision, {
      artifactId: row.id,
      version: 1,
      payload: input.payload,
      actorId: null,
      actorName: input.model,
      reason: 'AI 생성',
      reviewStatus: 'unreviewed',
      status: 'ready',
    });

    return row;
  }
  async dto(row: LearningArtifact, version = row.version) {
    const revision = await this.revision(row, version);

    return {
      id: row.id,
      kind: row.kind,
      version,
      status: version === row.version ? row.status : revision.status,
      reviewStatus:
        version === row.version ? row.reviewStatus : revision.reviewStatus,
      needsReview: row.needsReview,
      source: row.source,
      model: row.model,
      provider: row.provider,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      payload: revision.payload,
    };
  }
  async state(ownerId: string, row: LearningArtifact, version = row.version) {
    return (
      (await this.db.manager.findOneBy(ExerciseState, {
        ownerId,
        artifactId: row.id,
        version,
      })) ?? { draft: '', hintUsed: false, revealed: false, excluded: false }
    );
  }
  async exercise(ownerId: string, row: LearningArtifact) {
    const dto = await this.dto(row),
      payload = { ...dto.payload };

    // 서버에 저장한 채점 근거와 제출 전 학습자에게 보이는 문제를 같은 DTO로 노출하지 않는다.
    delete payload.answer;
    delete payload.explanation;
    delete payload.hint;

    const state = await this.state(ownerId, row),
      latest = await this.db.manager.findOne(ExerciseAttempt, {
        where: { ownerId, artifactId: row.id, version: row.version },
        order: { createdAt: 'DESC' },
      });

    return {
      ...dto,
      payload,
      state: {
        draft: state.draft,
        hintUsed: state.hintUsed,
        revealed: state.revealed,
        excluded: state.excluded,
      },
      latestResult: latest ? exerciseResult(latest) : null,
      expressionIds: row.expressionIds,
    };
  }
  async get(ownerId: string, id: string) {
    const row = await this.owned(ownerId, id);

    return row.kind === 'practice'
      ? this.exercise(ownerId, row)
      : this.dto(row);
  }
  async list(
    ownerId: string,
    kind: 'explanation' | 'practice',
    query: SourceQuery
  ) {
    const b = this.db
      .getRepository(LearningArtifact)
      .createQueryBuilder('a')
      .where('a.ownerId=:ownerId AND a.kind=:kind', { ownerId, kind });

    for (const key of [
      'materialId',
      'videoId',
      'segmentId',
      'language',
    ] as const)
      if (query[key])
        b.andWhere(`a.source->>'${key}'=:${key}`, { [key]: query[key] });
    if (query.kind)
      b.andWhere("a.source->>'kind'=:sourceKind", { sourceKind: query.kind });
    if (query.version)
      b.andWhere("COALESCE(a.source->>'version', '1') = :sourceVersion", {
        sourceVersion: String(query.version),
      });
    if (query.ocrId === 'none') b.andWhere("a.source->>'ocrId' IS NULL");
    else if (query.ocrId)
      b.andWhere("a.source->>'ocrId' = :ocrId", { ocrId: query.ocrId });
    if (query.page)
      b.andWhere("a.source->>'page'=:page", { page: String(query.page) });
    const rows = await b.orderBy('a.updatedAt', 'DESC').take(200).getMany();

    return {
      items: await Promise.all(
        rows.map((r) =>
          kind === 'practice' ? this.exercise(ownerId, r) : this.dto(r)
        )
      ),
    };
  }
}
