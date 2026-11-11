import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import type { z } from 'zod';
import { HttpError } from '../common/http-error.js';
import { HelperProfile } from '../database/entities/HelperProfile.entity.js';
import { User } from '../database/entities/User.entity.js';
import { containsPattern } from '../database/query.js';
import { SourceService } from '../learning/source.service.js';
import type { communityPostSchema, communityQuerySchema } from './contracts.js';

type Post = {
  id: string;
  ownerId: string;
  title: string;
  body: string;
  language: 'en' | 'th';
  visibility: 'public' | 'accounts';
  allowedUserIds: string[];
  taggedHelperIds: string[];
  source: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  hiddenAt: Date | null;
};

/** 조교도 일반 사용자로 참여하며 태그는 게시글의 공개 범위 안에서만 노출한다. */
@Injectable()
export class CommunityService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(SourceService) private readonly sources: SourceService
  ) {}
  private async readable(userId: string, id: string) {
    const rows: Post[] = await this.db.query(
      `SELECT * FROM "CommunityPost" WHERE id=$1 AND ("hiddenAt" IS NULL OR "ownerId"=$2) AND ("ownerId"=$2 OR visibility='public' OR "allowedUserIds" ? $2)`,
      [id, userId]
    );

    if (!rows[0]) throw new HttpError(404, '게시글을 찾을 수 없습니다.');

    return rows[0];
  }
  private async dto(userId: string, row: Post) {
    const author = await this.db.manager.findOneBy(User, { id: row.ownerId });

    const helper = await this.db.manager.existsBy(HelperProfile, {
      userId: row.ownerId,
      active: true,
    });

    const helpers: { id: string; name: string | null }[] = row.taggedHelperIds
      .length
      ? await this.db.query(
          `SELECT u.id,u.name FROM "User" u JOIN "HelperProfile" h ON h."userId"=u.id WHERE u.id=ANY($1::text[]) AND h.active=true ORDER BY u.name,u.id`,
          [row.taggedHelperIds]
        )
      : [];

    const counts: {
      likes: number;
      comments: number;
      liked: boolean;
      following: boolean;
    }[] = await this.db.query(
      `SELECT (SELECT count(*)::int FROM "CommunityReaction" WHERE "postId"=$1) AS likes,
      (SELECT count(*)::int FROM "CommunityComment" WHERE "postId"=$1) AS comments,
      EXISTS(SELECT 1 FROM "CommunityReaction" WHERE "postId"=$1 AND "userId"=$2) AS liked,
      EXISTS(SELECT 1 FROM "CommunityFollow" WHERE "followerId"=$2 AND "followingId"=$3) AS following`,
      [row.id, userId, row.ownerId]
    );

    // 글을 읽을 권한이 있어도 다른 수신자 계정 목록까지 공개할 필요는 없다.
    return {
      ...row,
      allowedUserIds: row.ownerId === userId ? row.allowedUserIds : [],
      author: { id: row.ownerId, name: author?.name ?? null, isHelper: helper },
      taggedHelpers: helpers,
      owned: row.ownerId === userId,
      ...counts[0],
    };
  }
  async list(userId: string, query: z.infer<typeof communityQuerySchema>) {
    if (
      query.tagged === 'true' &&
      !(await this.db.manager.existsBy(HelperProfile, { userId, active: true }))
    )
      throw new HttpError(403, '조교만 태그된 게시글을 조회할 수 있습니다.');

    const rows: Post[] = await this.db.query(
      `SELECT p.* FROM "CommunityPost" p WHERE (p."hiddenAt" IS NULL OR p."ownerId"=$1) AND (p."ownerId"=$1 OR p.visibility='public' OR p."allowedUserIds" ? $1)
      AND ($2::text IS NULL OR p.language=$2) AND (p.title ILIKE $3 OR p.body ILIKE $3)
      AND (NOT $4::boolean OR EXISTS(SELECT 1 FROM "CommunityFollow" f WHERE f."followerId"=$1 AND f."followingId"=p."ownerId"))
      AND (NOT $7::boolean OR p."taggedHelperIds" ? $1)
      ORDER BY p."updatedAt" DESC,p.id LIMIT $5 OFFSET $6`,
      [
        userId,
        query.language ?? null,
        containsPattern(query.q),
        query.following === 'true',
        query.limit + 1,
        (query.page - 1) * query.limit,
        query.tagged === 'true',
      ]
    );

    return {
      items: await Promise.all(
        rows.slice(0, query.limit).map((r) => this.dto(userId, r))
      ),
      page: query.page,
      limit: query.limit,
      hasMore: rows.length > query.limit,
    };
  }
  async create(
    userId: string,
    input: z.infer<typeof communityPostSchema>,
    id?: string
  ) {
    const allowed =
      input.visibility === 'accounts' ? [...new Set(input.allowedUserIds)] : [];

    if (
      allowed.length &&
      (await this.db.manager.countBy(User, { id: In(allowed) })) !==
        allowed.length
    )
      throw new HttpError(400, '공개할 계정을 확인해 주세요.');

    const taggedHelperIds = [...new Set(input.taggedHelperIds)];

    if (
      taggedHelperIds.length &&
      (await this.db.manager.countBy(HelperProfile, {
        userId: In(taggedHelperIds),
        active: true,
      })) !== taggedHelperIds.length
    )
      throw new HttpError(400, '활성화된 조교만 태그할 수 있습니다.');
    // 태그가 비공개 글의 수신 범위를 암묵적으로 넓히지 않게 한다.
    if (
      input.visibility === 'accounts' &&
      taggedHelperIds.some((id) => id !== userId && !allowed.includes(id))
    )
      throw new HttpError(
        400,
        '태그할 조교를 글의 공개 대상에도 포함해 주세요.'
      );

    // 선택 발췌만 저장해 비공개 PDF·원문 전체의 권한이 글 공개로 함께 열리지 않게 한다.
    const source = input.source
      ? await this.sources.resolve(userId, input.source)
      : null;

    if (source && source.language !== input.language)
      throw new HttpError(400, '글과 첨부 원문의 언어가 다릅니다.');

    const params = [
      input.title,
      input.body,
      input.language,
      input.visibility,
      JSON.stringify(allowed),
      source ? JSON.stringify(source) : null,
    ];

    let rows: Post[];

    if (id) {
      await this.readable(userId, id);

      rows = await this.db.query(
        `WITH changed AS (UPDATE "CommunityPost" SET title=$1,body=$2,language=$3,visibility=$4,"allowedUserIds"=$5,source=$6,"taggedHelperIds"=$9,"updatedAt"=now() WHERE id=$7 AND "ownerId"=$8 RETURNING *) SELECT * FROM changed`,
        [...params, id, userId, JSON.stringify(taggedHelperIds)]
      );

      if (!rows[0]) throw new HttpError(403, '본인의 글만 수정할 수 있습니다.');
    } else
      rows = await this.db.query(
        `INSERT INTO "CommunityPost"(title,body,language,visibility,"allowedUserIds",source,"ownerId","taggedHelperIds") VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [...params, userId, JSON.stringify(taggedHelperIds)]
      );

    return this.dto(userId, rows[0]);
  }
  async helpers() {
    const items: { id: string; name: string | null }[] = await this.db.query(
      `SELECT u.id,u.name FROM "HelperProfile" h JOIN "User" u ON u.id=h."userId" WHERE h.active=true ORDER BY u.name,u.id`
    );

    return { items };
  }
  async get(userId: string, id: string) {
    const row = await this.readable(userId, id);

    const comments: Record<string, unknown>[] = await this.db.query(
      `SELECT c.id,c.body,c."createdAt",c."ownerId",u.name AS "authorName",EXISTS(SELECT 1 FROM "HelperProfile" h WHERE h."userId"=u.id AND h.active=true) AS "isHelper" FROM "CommunityComment" c JOIN "User" u ON u.id=c."ownerId" WHERE c."postId"=$1 ORDER BY c."createdAt",c.id`,
      [id]
    );

    return {
      ...(await this.dto(userId, row)),
      comments: comments.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt,
        author: { id: c.ownerId, name: c.authorName, isHelper: c.isHelper },
        owned: c.ownerId === userId,
      })),
    };
  }
  async remove(userId: string, id: string) {
    const row = await this.readable(userId, id);

    if (row.ownerId !== userId)
      throw new HttpError(403, '본인의 글만 삭제할 수 있습니다.');

    await this.db.query(
      'DELETE FROM "CommunityPost" WHERE id=$1 AND "ownerId"=$2',
      [id, userId]
    );

    return { ok: true };
  }
  async comment(userId: string, id: string, body: string) {
    await this.readable(userId, id);

    const rows: { id: string }[] = await this.db.query(
      'INSERT INTO "CommunityComment"("postId","ownerId",body) VALUES($1,$2,$3) RETURNING id',
      [id, userId, body]
    );

    return { id: rows[0].id };
  }
  async removeComment(userId: string, id: string, commentId: string) {
    const row = await this.readable(userId, id);

    await this.db.query(
      'DELETE FROM "CommunityComment" WHERE id=$1 AND "postId"=$2 AND ("ownerId"=$3 OR $4::boolean)',
      [commentId, id, userId, row.ownerId === userId]
    );

    return { ok: true };
  }
  async react(userId: string, id: string, active: boolean) {
    await this.readable(userId, id);
    if (active)
      await this.db.query(
        'INSERT INTO "CommunityReaction"("postId","userId") VALUES($1,$2) ON CONFLICT DO NOTHING',
        [id, userId]
      );
    else
      await this.db.query(
        'DELETE FROM "CommunityReaction" WHERE "postId"=$1 AND "userId"=$2',
        [id, userId]
      );

    return { ok: true };
  }
  async report(userId: string, id: string, reason: string) {
    await this.readable(userId, id);

    return this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `community-report:${userId}:${id}`,
      ]);

      const existing: { id: string }[] = await tx.query(
        `SELECT id FROM "CommunityReport" WHERE "postId"=$1 AND "reporterId"=$2 AND status='open'`,
        [id, userId]
      );

      if (existing[0]) return { id: existing[0].id };

      const rows: { id: string }[] = await tx.query(
        'INSERT INTO "CommunityReport"("postId","reporterId",reason) VALUES($1,$2,$3) RETURNING id',
        [id, userId, reason]
      );

      return { id: rows[0].id };
    });
  }
  async follow(userId: string, targetId: string, active: boolean) {
    if (userId === targetId)
      throw new HttpError(400, '본인은 팔로우할 수 없습니다.');
    if (!(await this.db.manager.existsBy(User, { id: targetId })))
      throw new HttpError(404, '계정을 찾을 수 없습니다.');
    if (active)
      await this.db.query(
        'INSERT INTO "CommunityFollow"("followerId","followingId") VALUES($1,$2) ON CONFLICT DO NOTHING',
        [userId, targetId]
      );
    else
      await this.db.query(
        'DELETE FROM "CommunityFollow" WHERE "followerId"=$1 AND "followingId"=$2',
        [userId, targetId]
      );

    return { ok: true };
  }
}
