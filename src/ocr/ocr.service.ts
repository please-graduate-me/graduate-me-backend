import { Inject, Injectable } from '@nestjs/common';
import { DataSource, LessThan, MoreThan } from 'typeorm';
import type { z } from 'zod';
import { Material } from '../database/entities/Material.entity.js';
import { MaterialVersion } from '../database/entities/MaterialVersion.entity.js';
import { MaterialOcrPage } from '../database/entities/MaterialOcrPage.entity.js';
import { HttpError } from '../common/http-error.js';
import { readableMaterial } from '../learning/access.js';
import { UsageService } from '../ai/usage.service.js';
import { OperationService } from '../ai/operation.service.js';
import { OcrProviderService } from './ocr-provider.service.js';
import { extractOcrPage } from './pdf-page.js';
import type { ocrInputSchema, ocrQuerySchema } from './contracts.js';

function pageDto(row: MaterialOcrPage | null) {
  if (!row) return null;

  return {
    id: row.id,
    materialId: row.materialId,
    version: row.version,
    page: row.page,
    status: row.status,
    provider: row.provider,
    model: row.model,
    text: row.text,
    fields: row.fields,
    width: row.width,
    height: row.height,
    lowConfidenceCount: row.lowConfidenceCount,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function pageCost() {
  const configured = process.env.OCR_ESTIMATED_USD_PER_PAGE;

  return configured !== undefined &&
    configured.trim() !== '' &&
    Number.isFinite(Number(configured)) &&
    Number(configured) >= 0
    ? Number(configured)
    : null;
}

@Injectable()
/** 명시적 인식만 실행하며 완료 결과와 원본 버전은 수정하지 않는다. */
export class OcrService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(OcrProviderService) private readonly provider: OcrProviderService,
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(OperationService) private readonly operations: OperationService
  ) {}
  private dto(language: 'en' | 'th', row: MaterialOcrPage | null) {
    const identity = this.provider.identity();

    return {
      provider: identity.provider,
      model: identity.model,
      configured: identity.configured,
      supportedLanguages: identity.supportedLanguages,
      languageSupported: identity.supportedLanguages.includes(language),
      item: pageDto(row),
    };
  }
  private async stopAbandoned() {
    // 완료 기록은 건드리지 않고 프로세스가 끊긴 실행만 명시적 재요청 가능 상태로 바꾼다.
    await this.db.manager.update(
      MaterialOcrPage,
      {
        status: 'running',
        updatedAt: LessThan(new Date(Date.now() - 30 * 60000)),
      },
      {
        status: 'failed',
        error:
          '인식 처리가 중단되었습니다. 새 요청으로 다시 인식할 수 있습니다.',
      }
    );
  }
  async get(
    userId: string,
    materialId: string,
    input: z.infer<typeof ocrQuerySchema>
  ) {
    const material = await readableMaterial(this.db, userId, materialId);

    const snapshot =
      input.version === material.version
        ? material
        : await this.db.manager.findOneBy(MaterialVersion, {
            materialId,
            version: input.version,
          });

    if (!snapshot || input.page > snapshot.pages.length)
      throw new HttpError(404, '이 PDF 버전 또는 페이지를 찾을 수 없습니다.');
    await this.stopAbandoned();

    const row = await this.db.manager.findOneBy(MaterialOcrPage, {
      materialId,
      ...input,
    });

    return this.dto(snapshot.language, row);
  }
  async recognize(
    userId: string,
    materialId: string,
    input: z.infer<typeof ocrInputSchema>
  ) {
    const material = await readableMaterial(this.db, userId, materialId);

    if (material.ownerId !== userId)
      throw new HttpError(403, '본인이 등록한 PDF만 새로 인식할 수 있습니다.');
    if (material.version !== input.version)
      throw new HttpError(
        409,
        '현재 PDF 원본 버전에서만 새로 인식할 수 있습니다.'
      );
    if (input.page > material.pages.length)
      throw new HttpError(400, 'PDF 페이지 범위를 확인해 주세요.');
    const key = { materialId, version: input.version, page: input.page };
    const existing = await this.db.manager.findOneBy(MaterialOcrPage, key);

    if (existing?.status === 'ready')
      return this.dto(material.language, existing);
    const identity = this.provider.identity();

    if (!identity.supportedLanguages.includes(material.language))
      throw new HttpError(
        422,
        '선택한 OCR 공급자가 이 자료의 언어를 지원하지 않습니다.'
      );
    if (!identity.configured)
      throw new HttpError(503, '선택한 OCR 공급자의 연결 설정이 필요합니다.');
    await this.stopAbandoned();

    const item = await this.operations.run(
      userId,
      input.requestId,
      'pdf_ocr',
      { ...key, provider: identity.provider, model: identity.model },
      async () => {
        const claim = await this.db.transaction(async (tx) => {
          await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            'pdf-ocr-global',
          ]);

          const current = await tx.findOne(Material, {
            where: { id: materialId, ownerId: userId },
            lock: { mode: 'pessimistic_read' },
          });

          if (!current || current.version !== input.version)
            throw new HttpError(
              409,
              'PDF 원본이 변경되었습니다. 현재 버전을 확인해 주세요.'
            );
          const row = await tx.findOneBy(MaterialOcrPage, key);

          if (row?.status === 'ready') return { row, cached: true };
          if (row?.status === 'running')
            throw new HttpError(
              409,
              '이 페이지를 인식 중입니다. 저장 결과를 잠시 후 확인해 주세요.'
            );
          if (
            await tx.exists(MaterialOcrPage, {
              where: [
                { status: 'running' },
                { updatedAt: MoreThan(new Date(Date.now() - 1000)) },
              ],
            })
          )
            throw new HttpError(
              429,
              '다른 페이지 인식이 진행 중이거나 방금 완료되었습니다. 잠시 후 다시 요청해 주세요.'
            );

          const started = {
            ...key,
            requestId: input.requestId,
            provider: identity.provider,
            model: identity.model,
            status: 'running' as const,
            text: '',
            fields: [],
            error: null,
            width: null,
            height: null,
            lowConfidenceCount: 0,
          };

          return {
            row: row
              ? await tx.save(MaterialOcrPage, { ...row, ...started })
              : await tx.save(MaterialOcrPage, started),
            cached: false,
          };
        });

        if (claim.cached) return this.dto(material.language, claim.row);

        try {
          const original = await this.db
            .getRepository(MaterialVersion)
            .createQueryBuilder('v')
            .addSelect('v.content')
            .where('v.materialId = :id AND v.version = :version', {
              id: materialId,
              version: input.version,
            })
            .getOne();

          if (!original)
            throw new HttpError(
              404,
              '인식할 PDF 원본 버전을 찾을 수 없습니다.'
            );
          const page = await extractOcrPage(original.content, input.page);

          const result = await this.usage.execute(
            {
              ownerId: userId,
              provider: identity.provider,
              task: 'pdf_ocr',
              model: identity.model,
              sourceKey: `pdf:${materialId}:${input.version}:${input.page}`,
              requestId: input.requestId,
              ...this.provider.reservation(identity),
              ...(identity.provider === 'naver'
                ? { reservedCost: pageCost() }
                : {}),
            },
            async () => {
              const recognized = await this.provider.recognize(
                {
                  ...page,
                  requestId: input.requestId,
                },
                identity
              );

              return {
                value: recognized,
                provider: recognized.provider,
                model: recognized.model,
                inputTokens: recognized.inputTokens,
                outputTokens: recognized.outputTokens,
              };
            }
          );

          const saved = await this.db.manager.update(
            MaterialOcrPage,
            { id: claim.row.id, status: 'running', requestId: input.requestId },
            {
              ...result.result,
              provider: result.provider,
              model: result.model,
              status: 'ready',
              error: null,
            }
          );

          if (!saved.affected)
            throw new HttpError(
              409,
              '이미 종료된 인식 요청입니다. 저장 상태를 확인해 주세요.'
            );

          const row = await this.db.manager.findOneByOrFail(MaterialOcrPage, {
            id: claim.row.id,
          });

          return this.dto(material.language, row);
        } catch (error) {
          await this.db.manager.update(
            MaterialOcrPage,
            { id: claim.row.id, status: 'running', requestId: input.requestId },
            {
              status: 'failed',
              error:
                '페이지 인식에 실패했습니다. 원본을 확인한 뒤 새 요청으로 다시 인식할 수 있습니다.',
            }
          );

          throw error;
        }
      }
    );

    return item;
  }
}
