import { Inject, Injectable } from '@nestjs/common';
import type { AdminShareQuery } from '@graduate-me/shared';
import { PrismaService } from '../database/prisma.service.js';
import { HttpError } from '../common/http-error.js';

@Injectable()
/** 운영자가 지정한 계정만 공유자 정보와 집계를 조회하게 한다. */
export class AdminService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async allowed(userId: string) {
    const emails = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    if (!emails.length) return false;

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    return Boolean(user?.email && emails.includes(user.email.toLowerCase()));
  }
  async shares(query: AdminShareQuery) {
    const [links, visits, starts, rows] = await this.db.$transaction([
      this.db.shareLink.count(),
      this.db.shareVisit.count(),
      this.db.shareStart.count(),
      this.db.shareLink.findMany({
        where: query.q
          ? {
              OR: [
                {
                  video: { title: { contains: query.q, mode: 'insensitive' } },
                },
                {
                  creator: {
                    email: { contains: query.q, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {},
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit + 1,
        select: {
          id: true,
          createdAt: true,
          revokedAt: true,
          video: { select: { title: true, id: true } },
          segment: { select: { start: true, end: true } },
          creator: { select: { name: true, email: true } },
          _count: { select: { visits: true, starts: true } },
        },
      }),
    ]);

    return {
      summary: { links, visits, starts },
      items: rows.slice(0, query.limit).map(({ _count, ...link }) => ({
        ...link,
        visitCount: _count.visits,
        startCount: _count.starts,
      })),
      page: query.page,
      hasMore: rows.length > query.limit,
    };
  }
  async revoke(id: string) {
    const result = await this.db.shareLink.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (
      !result.count &&
      !(await this.db.shareLink.findUnique({ where: { id } }))
    )
      throw new HttpError(404, '공유 링크를 찾을 수 없습니다.');

    return { ok: true };
  }
}
