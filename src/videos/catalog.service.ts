import { containsPattern } from '../database/query.js';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Video } from '../database/entities/Video.entity.js';
import type { PublicVideoQuery } from './catalog-contracts.js';

/** 공용 목록에 개인 정보가 섞이지 않도록 공개 조회를 분리한다. */
@Injectable()
export class CatalogService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  private available(userId?: string) {
    const builder = this.db
      .getRepository(Video)
      .createQueryBuilder('v')
      .innerJoin('v.job', 'j', 'j.status = :status', { status: 'ready' })
      .where('EXISTS (SELECT 1 FROM "Segment" s WHERE s."videoId" = v.id)');

    return userId
      ? builder.andWhere(
          `(v.visibility = 'public' OR (v.visibility = 'accounts' AND v."allowedUserIds" ? :userId))`,
          { userId }
        )
      : builder.andWhere("v.visibility = 'public'");
  }
  async list(query: PublicVideoQuery, userId?: string) {
    const builder = this.available(userId)
      .select('v.id', 'id')
      .addSelect('v.youtubeId', 'youtubeId')
      .addSelect('v.title', 'title')
      .addSelect('v.duration', 'duration')
      .addSelect('v.category', 'category')
      .addSelect('v.language', 'language')
      .addSelect(
        '(SELECT count(*)::int FROM "VideoLike" l WHERE l."videoId" = v.id)',
        'likeCount'
      );

    if (query.language)
      builder.andWhere('v.language = :language', { language: query.language });
    if (query.category)
      builder.andWhere('v.category = :category', { category: query.category });
    if (query.q)
      builder.andWhere('v.title ILIKE :q', { q: containsPattern(query.q) });
    if (query.sort === 'popular') builder.orderBy('"likeCount"', 'DESC');

    // 한 개 더 조회해 전체 집계 없이 다음 페이지 유무를 알린다.
    const rows = await builder
      .addOrderBy('v.createdAt', 'DESC')
      .addOrderBy('v.id', 'ASC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit + 1)
      .getRawMany<{
        id: string;
        youtubeId: string;
        title: string;
        duration: number | null;
        category: string | null;
        language: 'en' | 'th';
        likeCount: number;
      }>();

    return {
      items: rows.slice(0, query.limit),
      page: query.page,
      limit: query.limit,
      hasMore: rows.length > query.limit,
    };
  }
  async categories(userId?: string) {
    return this.available(userId)
      .andWhere('v.category IS NOT NULL')
      .select('v.category', 'category')
      .addSelect('count(*)::int', 'count')
      .groupBy('v.category')
      .orderBy('v.category', 'ASC')
      .getRawMany<{ category: string; count: number }>();
  }
}
