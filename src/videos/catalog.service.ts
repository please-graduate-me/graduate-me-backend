import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PublicVideoQuery } from '@graduate-me/shared';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
/** 공용 목록에 개인 정보가 섞이지 않도록 공개 조회를 분리한다. */
export class CatalogService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async list(query: PublicVideoQuery) {
    const where: Prisma.VideoWhereInput = {
      job: { is: { status: 'ready' } },
      segments: { some: { excluded: false } },
      ...(query.category ? { category: query.category } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const orderBy: Prisma.VideoOrderByWithRelationInput[] =
      query.sort === 'popular'
        ? [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }, { id: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'asc' }];

    // 한 개 더 조회해 전체 집계 없이 다음 페이지 유무를 알린다.
    const rows = await this.db.video.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit + 1,
      select: {
        id: true,
        youtubeId: true,
        title: true,
        duration: true,
        category: true,
        downloadedAt: true,
        _count: { select: { likes: true } },
      },
    });

    return {
      items: rows
        .slice(0, query.limit)
        .map(({ _count, ...video }) => ({ ...video, likeCount: _count.likes })),
      page: query.page,
      limit: query.limit,
      hasMore: rows.length > query.limit,
    };
  }
  async categories() {
    const rows = await this.db.video.groupBy({
      by: ['category'],
      where: {
        category: { not: null },
        job: { is: { status: 'ready' } },
        segments: { some: { excluded: false } },
      },
      _count: { _all: true },
      orderBy: { category: 'asc' },
    });

    return rows.map((row) => ({
      category: row.category!,
      count: row._count._all,
    }));
  }
}
