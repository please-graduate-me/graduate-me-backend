import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { MaterialAnalysis } from '../database/entities/MaterialAnalysis.entity.js';
import { MaterialVersion } from '../database/entities/MaterialVersion.entity.js';
import { User } from '../database/entities/User.entity.js';
import { readableMaterial } from '../learning/access.js';
import { HttpError } from '../common/http-error.js';

/** 전체 정리 상한은 구절 설명의 페이지 제한과 독립적으로 유지한다. */
export const materialAnalysisPageLimit = 30;

/** 원본과 같은 트랜잭션에서 분석 요청과 당시 해설 언어를 확정한다. */
export async function enqueueMaterialAnalysis(
  tx: EntityManager,
  source: {
    id: string;
    version: number;
    ownerId: string;
    pages: string[];
  }
) {
  const user = await tx.findOneBy(User, { id: source.ownerId });
  const skipped = source.pages.length > materialAnalysisPageLimit;

  await tx.insert(MaterialAnalysis, {
    materialId: source.id,
    version: source.version,
    ownerId: source.ownerId,
    explanationLanguage: user?.explanationLanguage ?? 'ko',
    status: skipped ? 'skipped' : 'queued',
    error: skipped
      ? '전체 자동 정리는 30페이지 이하의 PDF에서 지원합니다. 원본 읽기와 구절 학습은 계속 이용할 수 있습니다.'
      : null,
    pages: skipped
      ? []
      : source.pages.map((_, index) => ({
          page: index + 1,
          status: 'queued' as const,
          result: null,
          error: null,
          provider: null,
          model: null,
        })),
  });
}

/** 저장된 원본 버전에 대한 조회·수동 재요청과 작업 소유권을 관리한다. */
@Injectable()
export class MaterialAnalysisService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}

  private async source(userId: string, materialId: string, version: number) {
    const material = await readableMaterial(this.db, userId, materialId);

    const snapshot = await this.db.manager.findOneBy(MaterialVersion, {
      materialId,
      version,
    });

    if (!snapshot)
      throw new HttpError(404, '분석할 원본 버전을 찾을 수 없습니다.');

    return { material, snapshot };
  }

  async get(userId: string, materialId: string, version: number) {
    const { material } = await this.source(userId, materialId, version);

    const row = await this.db.manager.findOneBy(MaterialAnalysis, {
      materialId,
      version,
    });

    if (!row) return { analysis: null };

    const words = row.pages.flatMap((p) =>
      (p.result?.words ?? []).map((word, index) => ({
        ...word,
        id: `${p.page}:${index}`,
        page: p.page,
      }))
    );

    const selected = new Set(row.overview?.wordIds ?? []);
    const seen = new Set<string>();

    const vocabulary = words
      .filter((word) => {
        const key = word.lemma.normalize('NFKC').toLowerCase();

        if (!selected.has(word.id) || seen.has(key)) return false;
        seen.add(key);

        return true;
      })
      .slice(0, 50);

    return {
      analysis: {
        id: row.id,
        version: row.version,
        status: row.status,
        explanationLanguage: row.explanationLanguage,
        totalPages: row.pages.length,
        completedPages: row.pages.filter((p) => p.status === 'ready').length,
        error: row.error,
        canRetry:
          material.ownerId === userId &&
          ['failed', 'partial'].includes(row.status),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        overview: row.overview
          ? {
              documentType: row.overview.documentType,
              introduction: row.overview.introduction,
              summary: row.overview.summary,
              keyPoints: row.overview.keyPoints,
              vocabulary,
            }
          : null,
        pages: row.pages.map((p) => ({
          page: p.page,
          status: p.status,
          error: p.error,
          translation: p.result?.translation ?? null,
          sourceText: p.result?.sourceText ?? null,
          summary: p.result?.pageSummary ?? null,
          warnings: p.result?.warnings ?? [],
          provider: p.provider,
          model: p.model,
        })),
      },
    };
  }

  async retry(
    userId: string,
    materialId: string,
    version: number,
    requestId: string
  ) {
    const { material, snapshot } = await this.source(
      userId,
      materialId,
      version
    );

    if (material.ownerId !== userId)
      throw new HttpError(403, '자료 소유자만 분석을 다시 요청할 수 있습니다.');
    if (snapshot.pages.length > materialAnalysisPageLimit)
      throw new HttpError(400, '전체 정리는 최대 30페이지까지 가능합니다.');

    await this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `material-analysis:${materialId}:${version}`,
      ]);

      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `material-analysis-request:${requestId}`,
      ]);

      const existing = await tx.findOneBy(MaterialAnalysis, { requestId });

      if (
        existing &&
        (existing.ownerId !== userId ||
          existing.materialId !== materialId ||
          existing.version !== version)
      )
        throw new HttpError(409, '다른 분석 요청에 사용한 식별자입니다.');

      let row = await tx.findOne(MaterialAnalysis, {
        where: { materialId, version },
        lock: { mode: 'pessimistic_write' },
      });

      if (row?.requestId === requestId || row?.status === 'ready') return;
      if (row && ['queued', 'running'].includes(row.status))
        throw new HttpError(409, '자료 정리가 이미 진행 중입니다.');

      if (!row) {
        await enqueueMaterialAnalysis(tx, {
          id: materialId,
          ownerId: userId,
          version,
          pages: snapshot.pages,
        });

        row = await tx.findOneByOrFail(MaterialAnalysis, {
          materialId,
          version,
        });
      }

      await tx.update(MaterialAnalysis, row.id, {
        status: 'queued',
        error: null,
        leaseToken: null,
        heartbeatAt: null,
        requestId,
        pages: row.pages.map((p) =>
          p.status === 'ready'
            ? p
            : { ...p, status: 'queued' as const, error: null }
        ),
        updatedAt: new Date(),
      });
    });

    return this.get(userId, materialId, version);
  }

  async claim() {
    return this.db.transaction(async (tx) => {
      // 중단된 작업은 유료 호출을 자동 재실행하지 않고 완료된 페이지만 남긴다.
      await tx.query(`UPDATE "MaterialAnalysis" SET status=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(pages) p WHERE p->>'status'='ready') THEN 'partial' ELSE 'failed' END,
        error='자료 정리가 중단되었습니다. 완료된 결과를 확인하고 남은 페이지를 다시 요청해 주세요.', "leaseToken"=NULL,"heartbeatAt"=NULL,"updatedAt"=now()
        WHERE status='running' AND "heartbeatAt" < now()-interval '90 seconds'`);

      const rows: MaterialAnalysis[] = await tx.query(
        `SELECT * FROM "MaterialAnalysis" WHERE status='queued' ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 1`
      );

      const row = rows[0];

      if (!row) return null;
      row.status = 'running';
      row.leaseToken = randomUUID();
      row.heartbeatAt = new Date();

      await tx.update(MaterialAnalysis, row.id, {
        status: row.status,
        leaseToken: row.leaseToken,
        heartbeatAt: row.heartbeatAt,
        updatedAt: new Date(),
      });

      return row;
    });
  }

  async heartbeat(row: MaterialAnalysis) {
    const result = await this.db.manager.update(
      MaterialAnalysis,
      { id: row.id, leaseToken: row.leaseToken!, status: 'running' },
      { heartbeatAt: new Date() }
    );

    return result.affected === 1;
  }

  async save(row: MaterialAnalysis, finished = false) {
    const completed = row.pages.filter((p) => p.status === 'ready').length;

    const status = finished
      ? completed === row.pages.length && completed > 0
        ? 'ready'
        : completed > 0
          ? 'partial'
          : 'failed'
      : 'running';

    const result = await this.db.manager.update(
      MaterialAnalysis,
      { id: row.id, leaseToken: row.leaseToken!, status: 'running' },
      {
        pages: row.pages,
        overview: row.overview,
        error: row.error,
        status,
        ...(finished ? { leaseToken: null, heartbeatAt: null } : {}),
        updatedAt: new Date(),
      }
    );

    if (result.affected !== 1)
      throw new HttpError(409, '분석 작업의 소유권이 변경되었습니다.');
  }
}
