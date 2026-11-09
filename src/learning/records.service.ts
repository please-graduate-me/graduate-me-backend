import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import { z } from 'zod';
import { Annotation } from '../database/entities/Annotation.entity.js';
import { ExcerptShare } from '../database/entities/ExcerptShare.entity.js';
import { User } from '../database/entities/User.entity.js';
import { HttpError } from '../common/http-error.js';
import { sourceInputSchema } from './contracts.js';
import { SourceService } from './source.service.js';

/** 하이라이트는 확인한 원문과 사용자 선택 색·메모만 저장한다. */
export const annotationInputSchema = z.object({
  source: sourceInputSchema,
  color: z.enum(['yellow', 'blue', 'green']).default('yellow'),
  memo: z.string().max(20_000).default(''),
});

/** 원문 위치를 바꾸지 않고 본인 하이라이트의 표시와 메모만 변경한다. */
export const annotationUpdateSchema = z.object({
  color: z.enum(['yellow', 'blue', 'green']).optional(),
  memo: z.string().max(20_000).optional(),
});

/** 원본 식별자를 하나만 받아 다른 자료의 개인 기록과 섞이지 않게 한다. */
export const annotationsQuerySchema = z
  .object({
    materialId: z.string().min(1).max(128).optional(),
    videoId: z.string().min(1).max(128).optional(),
  })
  .refine((value) => Boolean(value.materialId) !== Boolean(value.videoId));

/** 공유 대상은 학생이 명시적으로 선택하며 계정 전용에는 수신자가 필요하다. */
export const excerptShareInputSchema = z
  .object({
    source: sourceInputSchema,
    visibility: z.enum(['link', 'accounts']),
    allowedUserIds: z.array(z.string().min(1).max(128)).max(100).default([]),
  })
  .refine(
    (value) =>
      value.visibility !== 'accounts' || value.allowedUserIds.length > 0
  );

function annotationDetail(row: Annotation) {
  return {
    id: row.id,
    source: row.source,
    color: row.color,
    memo: row.memo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function shareDetail(row: ExcerptShare) {
  return {
    id: row.id,
    path: `/shared/${row.id}` as const,
    source: row.source,
    visibility: row.visibility,
    allowedUserIds: row.allowedUserIds,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

@Injectable()
/** 개인 주석과 선택 발췌 공유는 원본·대화·답안의 접근 권한과 분리한다. */
export class RecordsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(SourceService) private readonly sources: SourceService
  ) {}
  async annotations(
    userId: string,
    query: z.infer<typeof annotationsQuerySchema>
  ) {
    const builder = this.db
      .getRepository(Annotation)
      .createQueryBuilder('a')
      .where('a.ownerId = :userId', { userId });

    if (query.materialId)
      builder.andWhere(
        "a.source->>'kind' = 'pdf' AND a.source->>'materialId' = :id",
        { id: query.materialId }
      );
    else
      builder.andWhere(
        "a.source->>'kind' = 'video' AND a.source->>'videoId' = :id",
        { id: query.videoId }
      );
    const rows = await builder.orderBy('a.updatedAt', 'DESC').getMany();

    return { items: rows.map(annotationDetail) };
  }
  async annotate(userId: string, input: z.infer<typeof annotationInputSchema>) {
    const source = await this.sources.resolve(userId, input.source);

    const row = await this.db.transaction(async (tx) => {
      // 같은 선택의 동시 저장은 한 주석으로 수렴시키고 기존 메모를 조용히 덮어쓰지 않는다.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `annotation:${userId}:${JSON.stringify(source)}`,
      ]);

      const existing = await tx
        .getRepository(Annotation)
        .createQueryBuilder('a')
        .where('a.ownerId = :userId AND a.source = CAST(:source AS jsonb)', {
          userId,
          source: JSON.stringify(source),
        })
        .getOne();

      return (
        existing ??
        tx.save(Annotation, {
          ownerId: userId,
          source,
          color: input.color,
          memo: input.memo,
        })
      );
    });

    return annotationDetail(row);
  }
  private async ownedAnnotation(userId: string, id: string) {
    const row = await this.db.manager.findOneBy(Annotation, {
      id,
      ownerId: userId,
    });

    if (!row) throw new HttpError(404, '하이라이트를 찾을 수 없습니다.');

    return row;
  }
  async updateAnnotation(
    userId: string,
    id: string,
    input: z.infer<typeof annotationUpdateSchema>
  ) {
    await this.ownedAnnotation(userId, id);
    if (Object.keys(input).length)
      await this.db.manager.update(Annotation, { id, ownerId: userId }, input);

    return annotationDetail(await this.ownedAnnotation(userId, id));
  }
  async removeAnnotation(userId: string, id: string) {
    await this.ownedAnnotation(userId, id);
    await this.db.manager.delete(Annotation, { id, ownerId: userId });

    return { ok: true };
  }
  async shares(userId: string) {
    const rows = await this.db.manager.find(ExcerptShare, {
      where: { ownerId: userId },
      order: { createdAt: 'DESC' },
    });

    return { items: rows.map(shareDetail) };
  }
  async share(userId: string, input: z.infer<typeof excerptShareInputSchema>) {
    const source = await this.sources.resolve(userId, input.source);

    const allowedUserIds =
      input.visibility === 'accounts' ? [...new Set(input.allowedUserIds)] : [];

    if (
      allowedUserIds.length &&
      (await this.db.manager.count(User, {
        where: { id: In(allowedUserIds) },
      })) !== allowedUserIds.length
    )
      throw new HttpError(400, '공유할 계정을 확인해 주세요.');

    const row = await this.db.manager.save(ExcerptShare, {
      ownerId: userId,
      source,
      visibility: input.visibility,
      allowedUserIds,
      revokedAt: null,
    });

    return shareDetail(row);
  }
  async shared(userId: string, id: string) {
    const row = await this.db.manager.findOneBy(ExcerptShare, { id });

    if (
      !row ||
      (row.visibility === 'accounts' &&
        row.ownerId !== userId &&
        !row.allowedUserIds.includes(userId))
    )
      throw new HttpError(404, '공유된 발췌를 찾을 수 없습니다.');
    if (row.revokedAt)
      throw new HttpError(410, '공유자가 이 발췌의 공유를 철회했습니다.');

    return { id: row.id, source: row.source, createdAt: row.createdAt };
  }
  async revoke(userId: string, id: string) {
    const row = await this.db.manager.findOneBy(ExcerptShare, {
      id,
      ownerId: userId,
    });

    if (!row) throw new HttpError(404, '공유된 발췌를 찾을 수 없습니다.');

    await this.db.manager.update(
      ExcerptShare,
      { id, ownerId: userId, revokedAt: IsNull() },
      { revokedAt: new Date() }
    );

    return { ok: true };
  }
}
