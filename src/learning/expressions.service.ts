import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { z } from 'zod';
import { Expression } from '../database/entities/Expression.entity.js';
import { PracticeAttempt } from '../database/entities/PracticeAttempt.entity.js';
import { LearningArtifact } from '../database/entities/LearningArtifact.entity.js';
import { ArtifactRevision } from '../database/entities/ArtifactRevision.entity.js';
import { sameSource } from '../ai/artifact.service.js';
import { containsPattern } from '../database/query.js';
import type { LearningSource } from './contracts.js';
import { HttpError } from '../common/http-error.js';
import { normalizedExcerpt, SourceService } from './source.service.js';
import type {
  expressionInputSchema,
  expressionUpdateSchema,
  practiceInputSchema,
} from './contracts.js';

/** 계정 식별자 없이 표현의 공개 가능한 개인 화면 필드를 구성한다. */
export function expressionDetail(row: Expression) {
  return {
    id: row.id,
    text: row.text,
    meaning: row.meaning,
    note: row.note,
    source: row.source,
    kind: row.kind,
    reviewIncluded: row.reviewIncluded,
    explanationId: row.explanationId,
    explanationVersion: row.explanationVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 표현집의 개인 뜻·메모와 자가점검 기록을 소유 계정에 한정한다. */
@Injectable()
export class ExpressionsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(SourceService) private readonly sources: SourceService
  ) {}
  async owned(userId: string, id: string) {
    const row = await this.db.manager.findOneBy(Expression, {
      id,
      ownerId: userId,
    });

    if (!row) throw new HttpError(404, '저장한 표현을 찾을 수 없습니다.');

    return row;
  }
  async list(
    userId: string,
    filter: {
      language?: string;
      kind?: string;
      q?: string;
      reviewIncluded?: boolean;
    } = {}
  ) {
    const b = this.db
      .getRepository(Expression)
      .createQueryBuilder('e')
      .where('e.ownerId=:userId', { userId });

    if (filter.language)
      b.andWhere("e.source->>'language'=:language", {
        language: filter.language,
      });
    if (filter.kind) b.andWhere('e.kind=:kind', { kind: filter.kind });
    if (filter.q)
      b.andWhere('(e.text ILIKE :q OR e.meaning ILIKE :q OR e.note ILIKE :q)', {
        q: containsPattern(filter.q),
      });
    if (filter.reviewIncluded !== undefined)
      b.andWhere('e.reviewIncluded=:reviewIncluded', {
        reviewIncluded: filter.reviewIncluded,
      });
    const rows = await b.orderBy('e.updatedAt', 'DESC').getMany();

    return { items: rows.map(expressionDetail) };
  }
  async create(userId: string, input: z.infer<typeof expressionInputSchema>) {
    const source = await this.sources.resolve(userId, input.source);

    if (
      !normalizedExcerpt(source.quote).includes(normalizedExcerpt(input.text))
    )
      throw new HttpError(400, '표현을 선택한 발췌에서 확인할 수 없습니다.');

    const explanation = await this.explanation(
      userId,
      source,
      input.explanationId,
      input.explanationVersion
    );

    const row = await this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `expression:${userId}:${input.text}:${JSON.stringify({ ...source, rects: undefined })}`,
      ]);

      const existing = (
        await tx.find(Expression, {
          where: { ownerId: userId, text: input.text },
        })
      ).find(
        (e) =>
          sameSource(e.source, source) &&
          normalizedExcerpt(e.source.quote) === normalizedExcerpt(source.quote)
      );

      if (existing) return existing;

      return tx.save(Expression, {
        ownerId: userId,
        text: input.text,
        meaning: input.meaning,
        note: input.note,
        source,
        kind: input.kind ?? 'phrase',
        reviewIncluded: input.reviewIncluded ?? true,
        ...explanation,
      });
    });

    return expressionDetail(row);
  }
  async update(
    userId: string,
    id: string,
    input: z.infer<typeof expressionUpdateSchema>
  ) {
    const row = await this.owned(userId, id);

    const explanation =
      input.explanationId === undefined &&
      input.explanationVersion === undefined
        ? {}
        : await this.explanation(
            userId,
            row.source,
            input.explanationId === undefined
              ? row.explanationId
              : input.explanationId,
            input.explanationVersion === undefined
              ? row.explanationVersion
              : input.explanationVersion
          );

    if (Object.keys(input).length)
      await this.db.manager.update(
        Expression,
        { id, ownerId: userId },
        { ...input, ...explanation }
      );

    return expressionDetail(await this.owned(userId, id));
  }
  private async explanation(
    ownerId: string,
    source: LearningSource,
    id?: string | null,
    version?: number | null
  ) {
    if (!id) return { explanationId: null, explanationVersion: null };

    const artifact = await this.db.manager.findOneBy(LearningArtifact, {
      id,
      ownerId,
      kind: 'explanation',
    });

    if (
      !artifact ||
      !sameSource(source, artifact.source) ||
      !version ||
      !(await this.db.manager.findOneBy(ArtifactRevision, {
        artifactId: id,
        version,
      }))
    )
      throw new HttpError(
        400,
        '같은 원문과 버전의 본인 설명만 연결할 수 있습니다.'
      );

    return { explanationId: id, explanationVersion: version };
  }
  async remove(userId: string, id: string) {
    await this.owned(userId, id);
    await this.db.manager.delete(Expression, { id, ownerId: userId });

    return { ok: true };
  }
  async practice(userId: string, input: z.infer<typeof practiceInputSchema>) {
    const expression = await this.owned(userId, input.expressionId);

    const row = await this.db.transaction(async (tx) => {
      // 같은 자가점검의 네트워크 재전송은 복습 횟수를 늘리지 않고 최초 스냅샷을 돌려준다.
      if (input.requestId) {
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `self-practice:${input.requestId}`,
        ]);

        const existing = await tx.findOneBy(PracticeAttempt, {
          id: input.requestId,
        });

        if (existing) {
          if (
            existing.ownerId !== userId ||
            existing.expressionId !== input.expressionId ||
            existing.answer !== input.answer ||
            existing.correct !== input.correct ||
            existing.mode !== input.mode
          )
            throw new HttpError(409, '이미 사용한 자가점검 요청 식별자입니다.');

          return existing;
        }
      }

      return tx.save(PracticeAttempt, {
        ...(input.requestId ? { id: input.requestId } : {}),
        ownerId: userId,
        expressionId: expression.id,
        answer: input.answer,
        correct: input.correct,
        mode: input.mode,
        snapshot: {
          text: expression.text,
          meaning: expression.meaning,
          source: expression.source,
        },
      });
    });

    return { id: row.id, createdAt: row.createdAt };
  }
}
