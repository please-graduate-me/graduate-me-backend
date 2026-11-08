import { containsPattern } from '../database/query.js';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Video } from '../database/entities/Video.entity.js';
import type { PublicVideoQuery } from './catalog-contracts.js';

@Injectable()
/** 공용 목록에 개인 정보가 섞이지 않도록 공개 조회를 분리한다. */
export class CatalogService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  private available() {
    return this.db
      .getRepository(Video)
      .createQueryBuilder('v')
      .innerJoin('v.job', 'j', 'j.status = :status', { status: 'ready' })
      .where('EXISTS (SELECT 1 FROM "Segment" s WHERE s."videoId" = v.id)');
  }
  async list(query: PublicVideoQuery) {
    const builder = this.available()
      .select('v.id', 'id')
      .addSelect('v.youtubeId', 'youtubeId')
      .addSelect('v.title', 'title')
      .addSelect('v.duration', 'duration')
      .addSelect('v.category', 'category')
      .addSelect(
        '(SELECT count(*)::int FROM "VideoLike" l WHERE l."videoId" = v.id)',
        'likeCount'
      );

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
        likeCount: number;
      }>();

    return {
      items: rows.slice(0, query.limit),
      page: query.page,
      limit: query.limit,
      hasMore: rows.length > query.limit,
    };
  }
  async categories() {
    return this.available()
      .andWhere('v.category IS NOT NULL')
      .select('v.category', 'category')
      .addSelect('count(*)::int', 'count')
      .groupBy('v.category')
      .orderBy('v.category', 'ASC')
      .getRawMany<{ category: string; count: number }>();
  }
}
