import { activeProviderIdentity } from '../ai/provider-config.js';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, MoreThanOrEqual } from 'typeorm';
import { PDFDocument } from 'pdf-lib';
import { MaterialRegistration } from '../database/entities/MaterialRegistration.entity.js';
import { MaterialOcrPage } from '../database/entities/MaterialOcrPage.entity.js';
import { assessLearningText, materialPolicy } from './material-policy.js';
import { z } from 'zod';
import { Material } from '../database/entities/Material.entity.js';
import { MaterialReading } from '../database/entities/MaterialReading.entity.js';
import { MaterialVersion } from '../database/entities/MaterialVersion.entity.js';
import { MaterialAccess } from '../database/entities/MaterialAccess.entity.js';
import { LearningArtifact } from '../database/entities/LearningArtifact.entity.js';
import { HttpError } from '../common/http-error.js';
import { materialInputSchema, type materialUpdateSchema } from './contracts.js';
import { readableMaterial } from './access.js';

/** 원본 교체도 기존 업로드 한도를 유지하고 기대 버전이 있으면 충돌을 검사한다. */
export const materialVersionInputSchema = materialInputSchema.safeExtend({
  expectedVersion: z.number().int().positive().optional(),
});

/** PDF 원본과 개인 메모를 목록 응답에서 제외한다. */
export function materialSummary(material: Material) {
  return {
    id: material.id,
    title: material.title,
    language: material.language,
    filename: material.filename,
    pageCount: material.pages.length,
    currentPage: Math.min(material.currentPage, material.pages.length),
    status: 'ready' as const,
    version: material.version,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  };
}

async function pdfContent(input: z.infer<typeof materialInputSchema>) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.contentBase64))
    throw new HttpError(400, '올바른 PDF 파일이 아닙니다.');
  const content = Buffer.from(input.contentBase64, 'base64');

  const limits = materialPolicy().pdf;

  if (content.length > limits.maxBytes)
    throw new HttpError(
      413,
      `PDF는 ${limits.maxBytes / 1024 / 1024}MB 이하로 등록해 주세요.`
    );
  if (input.pages.length > limits.maxPages)
    throw new HttpError(
      413,
      `PDF는 ${limits.maxPages}페이지 이하로 등록해 주세요.`
    );
  if (content.subarray(0, 5).toString('ascii') !== '%PDF-')
    throw new HttpError(400, 'PDF 파일만 등록할 수 있습니다.');

  let count: number;

  try {
    const document = await PDFDocument.load(content, { updateMetadata: false });

    if (document.isEncrypted) throw new Error('암호화 원본');
    count = document.getPageCount();
  } catch {
    throw new HttpError(400, '암호화되지 않은 정상 PDF 파일을 등록해 주세요.');
  }

  if (count > limits.maxPages)
    throw new HttpError(
      413,
      `PDF 원본은 ${limits.maxPages}페이지 이하로 등록해 주세요.`
    );
  if (count < 1 || count !== input.pages.length)
    throw new HttpError(
      400,
      'PDF 원본의 실제 페이지 수와 추출된 페이지 수가 일치하지 않습니다.'
    );

  return content;
}

function snapshot(material: Material) {
  return {
    materialId: material.id,
    version: material.version,
    content: material.content,
    pages: material.pages,
    filename: material.filename,
    title: material.title,
    language: material.language,
    createdAt: material.updatedAt ?? material.createdAt,
  };
}

@Injectable()
/** 원본 열람 권한과 개인 읽기 위치·메모를 분리하고 PDF 과거 버전을 보존한다. */
export class MaterialsService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async owned(userId: string, id: string) {
    const material = await this.db.manager.findOneBy(Material, {
      id,
      ownerId: userId,
    });

    if (!material) throw new HttpError(404, '자료를 찾을 수 없습니다.');

    return material;
  }
  async list(userId: string) {
    const builder = this.db
      .getRepository(Material)
      .createQueryBuilder('m')
      .leftJoin(
        'MaterialAccess',
        'access',
        "access.id = m.id AND access.kind = 'pdf'"
      )
      .leftJoin(
        'MaterialReading',
        'reading',
        'reading.materialId = m.id AND reading.ownerId = :userId',
        { userId }
      )
      .select('m.id', 'id');

    for (const key of ['title', 'language', 'filename', 'version', 'createdAt'])
      builder.addSelect(`m.${key}`, key);

    const items = await builder
      .addSelect('m.ownerId = :userId', 'owned')
      .addSelect("COALESCE(access.visibility, 'private')", 'visibility')
      .addSelect(
        'LEAST(CASE WHEN m.ownerId = :userId THEN m.currentPage ELSE COALESCE(reading.currentPage, 1) END, jsonb_array_length(m.pages))',
        'currentPage'
      )
      .addSelect(
        'CASE WHEN m.ownerId = :userId THEN m.updatedAt ELSE COALESCE(reading.updatedAt, m.updatedAt) END',
        'updatedAt'
      )
      .addSelect('jsonb_array_length(m.pages)', 'pageCount')
      .addSelect("'ready'", 'status')
      .where(
        "m.ownerId = :userId OR access.visibility = 'public' OR (access.visibility = 'accounts' AND access.allowedUserIds @> CAST(:allowedUser AS jsonb))",
        { userId, allowedUser: JSON.stringify([userId]) }
      )
      .orderBy('"updatedAt"', 'DESC')
      .getRawMany<
        ReturnType<typeof materialSummary> & {
          owned: boolean;
          visibility: MaterialAccess['visibility'];
        }
      >();

    return { items };
  }
  detail(
    material: Material,
    reading?: { currentPage: number; memo: string },
    ocrPages: MaterialOcrPage[] = []
  ) {
    const pageTexts = material.pages.map(
      (text, index) =>
        ocrPages.find((page) => page.page === index + 1)?.text ?? text
    );

    return {
      ...materialSummary(material),
      latestVersion: material.version,
      currentPage: Math.min(reading?.currentPage ?? 1, material.pages.length),
      pages: material.pages,
      eligibility: assessLearningText(pageTexts.join('\n'), material.language),
      pageEligibility: pageTexts.map((text) =>
        assessLearningText(text, material.language)
      ),
      aiConfigured: activeProviderIdentity().configured,
      memo: reading?.memo ?? '',
      fileUrl: `/api/materials/${material.id}/versions/${material.version}/file`,
      capabilities: {
        explanation: true as const,
        generatedPractice: true as const,
        aiConfigured: activeProviderIdentity().configured,
      },
    };
  }
  async create(userId: string, input: z.infer<typeof materialInputSchema>) {
    const content = await pdfContent(input);

    const material = await this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `pdf-register:${userId}`,
      ]);

      const start = new Date();

      start.setUTCHours(0, 0, 0, 0);
      const limit = materialPolicy().pdf.dailyNewLimit;

      if (
        (await tx.count(MaterialRegistration, {
          where: { ownerId: userId, createdAt: MoreThanOrEqual(start) },
        })) >= limit
      )
        throw new HttpError(
          429,
          `오늘 새로 등록할 수 있는 PDF ${limit}개를 모두 사용했습니다. 기존 자료와 저장 결과는 계속 이용할 수 있습니다.`
        );

      const material = await tx.save(Material, {
        ownerId: userId,
        title: input.title,
        language: input.language,
        filename: input.filename,
        content,
        pages: input.pages,
        version: 1,
        currentPage: 1,
        memo: '',
      });

      await tx.insert(MaterialRegistration, {
        materialId: material.id,
        ownerId: userId,
      });

      await tx.insert(MaterialVersion, snapshot(material));

      await tx.insert(MaterialAccess, {
        id: material.id,
        kind: 'pdf',
        visibility: 'private',
        allowedUserIds: [],
        version: 1,
      });

      return material;
    });

    return {
      ...this.detail(material, { currentPage: 1, memo: '' }),
      owned: true,
      visibility: 'private' as const,
    };
  }
  async get(userId: string, id: string, version?: number) {
    let material = await readableMaterial(this.db, userId, id);
    const latestVersion = material.version;

    if (version !== undefined && version !== material.version) {
      const historical = await this.db.manager.findOneBy(MaterialVersion, {
        materialId: id,
        version,
      });

      if (!historical)
        throw new HttpError(404, '이 원본 버전을 찾을 수 없습니다.');
      material = { ...material, ...historical, id: material.id };
    }

    const reading =
      material.ownerId === userId
        ? { currentPage: material.currentPage, memo: material.memo }
        : await this.db.manager.findOneBy(MaterialReading, {
            ownerId: userId,
            materialId: id,
          });

    const access = await this.db.manager.findOneBy(MaterialAccess, {
      id,
      kind: 'pdf',
    });

    return {
      ...this.detail(
        material,
        reading ?? undefined,
        await this.db.manager.findBy(MaterialOcrPage, {
          materialId: id,
          version: material.version,
          status: 'ready',
        })
      ),
      owned: material.ownerId === userId,
      latestVersion,
      visibility: access?.visibility ?? 'private',
    };
  }
  async file(userId: string, id: string, version?: number) {
    const material = await readableMaterial(this.db, userId, id);

    if (version !== undefined && version !== material.version) {
      const historical = await this.db
        .getRepository(MaterialVersion)
        .createQueryBuilder('v')
        .addSelect('v.content')
        .where('v.materialId = :id AND v.version = :version', { id, version })
        .getOne();

      if (!historical)
        throw new HttpError(404, '이 원본 버전을 찾을 수 없습니다.');

      return { ...material, ...historical, id: material.id };
    }

    const content = await this.db
      .getRepository(Material)
      .createQueryBuilder('m')
      .addSelect('m.content')
      .where('m.id = :id', { id })
      .getOne();

    if (!content) throw new HttpError(404, '자료를 찾을 수 없습니다.');

    return content;
  }
  async update(
    userId: string,
    id: string,
    input: z.infer<typeof materialUpdateSchema>
  ) {
    const material = await readableMaterial(this.db, userId, id);

    if (input.currentPage && input.currentPage > material.pages.length)
      throw new HttpError(400, '문서의 페이지 범위를 확인해 주세요.');

    if (Object.keys(input).length) {
      if (material.ownerId === userId)
        await this.db.manager.update(Material, { id, ownerId: userId }, input);
      else
        await this.db.transaction(async (tx) => {
          // 같은 자료의 페이지 이동과 메모 저장이 개인 기록을 서로 초기화하지 않게 한다.
          await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `material-reading:${userId}:${id}`,
          ]);

          let reading = await tx.findOneBy(MaterialReading, {
            ownerId: userId,
            materialId: id,
          });

          if (!reading)
            reading = await tx.save(MaterialReading, {
              ownerId: userId,
              materialId: id,
              currentPage: 1,
              memo: '',
            });

          await tx.update(
            MaterialReading,
            { id: reading.id, ownerId: userId },
            input
          );
        });
    }

    return this.get(userId, id);
  }
  async versions(userId: string, id: string) {
    await readableMaterial(this.db, userId, id);

    const rows = await this.db.manager.find(MaterialVersion, {
      where: { materialId: id },
      order: { version: 'DESC' },
    });

    return {
      items: rows.map((row) => ({
        version: row.version,
        title: row.title,
        language: row.language,
        filename: row.filename,
        pageCount: row.pages.length,
        createdAt: row.createdAt,
      })),
    };
  }
  async replace(
    userId: string,
    id: string,
    input: z.infer<typeof materialVersionInputSchema>
  ) {
    const content = await pdfContent(input);

    await this.db.transaction(async (tx) => {
      const current = await tx
        .getRepository(Material)
        .createQueryBuilder('m')
        .addSelect('m.content')
        .where('m.id = :id AND m.ownerId = :userId', { id, userId })
        .setLock('pessimistic_write')
        .getOne();

      if (!current)
        throw new HttpError(404, '교체할 본인 자료를 찾을 수 없습니다.');
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== current.version
      )
        throw new HttpError(
          409,
          '다른 원본 버전이 먼저 적용되었습니다. 새로고침 후 확인해 주세요.'
        );
      if (
        current.content.equals(content) &&
        current.filename === input.filename &&
        current.title === input.title &&
        current.language === input.language &&
        JSON.stringify(current.pages) === JSON.stringify(input.pages)
      )
        return;

      await tx
        .createQueryBuilder()
        .insert()
        .into(MaterialVersion)
        .values(snapshot(current))
        .orIgnore()
        .execute();

      const next = {
        ...current,
        title: input.title,
        language: input.language,
        filename: input.filename,
        content,
        pages: input.pages,
        version: current.version + 1,
        currentPage: Math.min(current.currentPage, input.pages.length),
      };

      await tx.insert(MaterialVersion, {
        ...snapshot(next),
        createdAt: new Date(),
      });

      await tx.update(
        Material,
        { id, ownerId: userId },
        {
          title: next.title,
          language: next.language,
          filename: next.filename,
          content,
          pages: next.pages,
          version: next.version,
          currentPage: next.currentPage,
        }
      );

      await tx.update(
        MaterialAccess,
        { id, kind: 'pdf' },
        { version: next.version }
      );

      await tx
        .getRepository(LearningArtifact)
        .createQueryBuilder()
        .update()
        .set({ needsReview: true, reviewStatus: 'needs_review' })
        .where("source->>'kind' = 'pdf' AND source->>'materialId' = :id", {
          id,
        })
        .execute();
    });

    return this.get(userId, id);
  }
  async remove(userId: string, id: string) {
    await this.owned(userId, id);

    await this.db.transaction(async (tx) => {
      await tx.delete(Material, { id, ownerId: userId });
      await tx.delete(MaterialAccess, { id, kind: 'pdf' });
    });

    return { ok: true };
  }
}
