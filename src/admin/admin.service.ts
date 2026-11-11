import { containsPattern } from '../database/query.js';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { AdminShareQuery } from './contracts.js';
import { ShareLink } from '../database/entities/ShareLink.entity.js';
import { ShareVisit } from '../database/entities/ShareVisit.entity.js';
import { ShareStart } from '../database/entities/ShareStart.entity.js';
import { HttpError } from '../common/http-error.js';

/** 운영자가 지정한 계정만 공유자 정보와 집계를 조회하게 한다. */
@Injectable()
export class AdminService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async allowed(userId: string) {
    const rows: { allowed: boolean }[] = await this.db.query(
      'SELECT EXISTS(SELECT 1 FROM "AdminOperator" WHERE "userId"=$1 AND username=$2) AS allowed',
      [userId, process.env.ADMIN_LOGIN_ID?.trim() ?? '']
    );

    return rows[0].allowed;
  }

  async shares(query: AdminShareQuery) {
    return this.db.transaction(async (tx) => {
      const builder = tx
        .getRepository(ShareLink)
        .createQueryBuilder('link')
        .leftJoinAndSelect('link.video', 'video')
        .leftJoinAndSelect('link.segment', 'segment')
        .leftJoinAndSelect('link.creator', 'creator')
        .select([
          'link.id',
          'link.createdAt',
          'link.revokedAt',
          'video.id',
          'video.title',
          'segment.id',
          'segment.start',
          'segment.end',
          'creator.id',
          'creator.name',
          'creator.email',
        ])
        .addSelect(
          '(SELECT count(*)::int FROM "ShareVisit" v WHERE v."shareId" = link.id)',
          'visitCount'
        )
        .addSelect(
          '(SELECT count(*)::int FROM "ShareStart" s WHERE s."shareId" = link.id)',
          'startCount'
        );

      if (query.q)
        builder.where('(video.title ILIKE :q OR creator.email ILIKE :q)', {
          q: containsPattern(query.q),
        });

      const links = await tx.count(ShareLink);
      const visits = await tx.count(ShareVisit);
      const starts = await tx.count(ShareStart);

      const { entities: rows, raw } = await builder
        .orderBy('link.createdAt', 'DESC')
        .addOrderBy('link.id', 'ASC')
        .skip((query.page - 1) * query.limit)
        .take(query.limit + 1)
        .getRawAndEntities<{
          link_id: string;
          visitCount: number;
          startCount: number;
        }>();

      const counts = new Map(raw.map((row) => [row.link_id, row]));

      return {
        summary: { links, visits, starts },
        items: rows.slice(0, query.limit).map((link) => ({
          id: link.id,
          createdAt: link.createdAt,
          revokedAt: link.revokedAt,
          video: { id: link.video.id, title: link.video.title },
          segment: link.segment
            ? { start: link.segment.start, end: link.segment.end }
            : null,
          creator: link.creator
            ? { name: link.creator.name, email: link.creator.email }
            : null,
          visitCount: counts.get(link.id)?.visitCount ?? 0,
          startCount: counts.get(link.id)?.startCount ?? 0,
        })),
        page: query.page,
        hasMore: rows.length > query.limit,
      };
    });
  }
  async revoke(id: string) {
    // 반복 철회는 성공으로 유지하되 존재하지 않는 링크와는 구분한다.
    const result = await this.db.manager.update(
      ShareLink,
      { id, revokedAt: IsNull() },
      { revokedAt: new Date() }
    );

    if (
      !result.affected &&
      !(await this.db.manager.exists(ShareLink, { where: { id } }))
    )
      throw new HttpError(404, '공유 링크를 찾을 수 없습니다.');

    return { ok: true };
  }
}
