import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { z } from 'zod';
import { Material } from '../database/entities/Material.entity.js';
import { HttpError } from '../common/http-error.js';
import type { materialInputSchema, materialUpdateSchema } from './contracts.js';

/** PDF 원본과 개인 메모를 목록 응답에서 제외한다. */
export function materialSummary(material: Material) {
  return {
    id: material.id,
    title: material.title,
    language: material.language,
    filename: material.filename,
    pageCount: material.pages.length,
    currentPage: material.currentPage,
    status: 'ready' as const,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  };
}

@Injectable()
/** PDF 원본과 마지막 읽은 위치는 자료 소유자에게만 제공한다. */
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
      .select('m.id', 'id');

    for (const key of [
      'title',
      'language',
      'filename',
      'currentPage',
      'createdAt',
      'updatedAt',
    ])
      builder.addSelect(`m.${key}`, key);

    const items = await builder
      .addSelect('jsonb_array_length(m.pages)', 'pageCount')
      .addSelect("'ready'", 'status')
      .where('m.ownerId = :userId', { userId })
      .orderBy('m.updatedAt', 'DESC')
      .getRawMany<ReturnType<typeof materialSummary>>();

    return { items };
  }
  detail(material: Material) {
    return {
      ...materialSummary(material),
      pages: material.pages,
      memo: material.memo,
      fileUrl: `/api/materials/${material.id}/file`,
      capabilities: {
        explanation: false as const,
        generatedPractice: false as const,
      },
    };
  }
  async create(userId: string, input: z.infer<typeof materialInputSchema>) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.contentBase64))
      throw new HttpError(400, '올바른 PDF 파일이 아닙니다.');
    const content = Buffer.from(input.contentBase64, 'base64');

    if (content.length > 10 * 1024 * 1024)
      throw new HttpError(413, 'PDF는 10MB 이하로 등록해 주세요.');
    if (content.subarray(0, 5).toString('ascii') !== '%PDF-')
      throw new HttpError(400, 'PDF 파일만 등록할 수 있습니다.');

    const material = await this.db.manager.save(Material, {
      ownerId: userId,
      title: input.title,
      language: input.language,
      filename: input.filename,
      content,
      pages: input.pages,
      currentPage: 1,
      memo: '',
    });

    return this.detail(material);
  }
  async get(userId: string, id: string) {
    return this.detail(await this.owned(userId, id));
  }
  async file(userId: string, id: string) {
    const material = await this.db
      .getRepository(Material)
      .createQueryBuilder('m')
      .addSelect('m.content')
      .where('m.id = :id AND m.ownerId = :userId', { id, userId })
      .getOne();

    if (!material) throw new HttpError(404, '자료를 찾을 수 없습니다.');

    return material;
  }
  async update(
    userId: string,
    id: string,
    input: z.infer<typeof materialUpdateSchema>
  ) {
    const material = await this.owned(userId, id);

    if (input.currentPage && input.currentPage > material.pages.length)
      throw new HttpError(400, '문서의 페이지 범위를 확인해 주세요.');
    if (Object.keys(input).length)
      await this.db.manager.update(Material, { id, ownerId: userId }, input);

    return this.get(userId, id);
  }
  async remove(userId: string, id: string) {
    await this.owned(userId, id);
    await this.db.manager.delete(Material, { id, ownerId: userId });

    return { ok: true };
  }
}
