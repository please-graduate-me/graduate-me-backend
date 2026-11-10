import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, Not } from 'typeorm';
import type { z } from 'zod';
import { containsPattern } from '../database/query.js';
import { Material } from '../database/entities/Material.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { Job } from '../database/entities/Job.entity.js';
import { HelperProfile } from '../database/entities/HelperProfile.entity.js';
import { LearningQuestion } from '../database/entities/LearningQuestion.entity.js';
import { ReviewRequest } from '../database/entities/ReviewRequest.entity.js';
import { User } from '../database/entities/User.entity.js';
import { QuestionsService } from '../learning/questions.service.js';
import { HttpError } from '../common/http-error.js';
import type {
  helperInputSchema,
  HistoryQuery,
  moderationInputSchema,
} from './workspace-contracts.js';

/** 운영 집계는 저장된 기록만 사용하고 미측정 비용을 추정하지 않는다. */
@Injectable()
export class WorkspaceOperationsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(QuestionsService) private readonly questions: QuestionsService
  ) {}
  async overview() {
    const [processing, waiting, reviews, failed] = await Promise.all([
      this.db.manager.count(Job, {
        where: { status: Not(In(['ready', 'failed'])) },
      }),
      this.db.manager.count(LearningQuestion, { where: { status: 'waiting' } }),
      this.db.manager.count(ReviewRequest, { where: { status: 'open' } }),
      this.db.manager.count(Job, { where: { status: 'failed' } }),
    ]);

    return { processing, waiting, reviews, failed };
  }
  async materials(query?: HistoryQuery) {
    const {
      page = 1,
      limit = 100,
      q = '',
      status = 'all',
      period = 'all',
    } = query ?? {};

    // 원본·개인 메모를 읽지 않고 목록에 필요한 메타데이터만 합친다.
    const union = `SELECT m.id,m.title,'pdf' AS kind,m.language,
      jsonb_build_object('id',m."ownerId",'name',u.name) AS owner,
      jsonb_array_length(m.pages) AS "pageCount",NULL::double precision AS duration,
      'ready' AS status,m."createdAt",COALESCE(a.visibility,'private') AS visibility
      FROM "Material" m LEFT JOIN "User" u ON u.id=m."ownerId"
      LEFT JOIN "MaterialAccess" a ON a.id=m.id AND a.kind='pdf'
      UNION ALL SELECT v.id,v.title,'video',v.language,
      CASE WHEN v."ownerId" IS NULL THEN NULL ELSE jsonb_build_object('id',v."ownerId",'name',u.name) END,
      NULL::integer,v.duration,COALESCE(j.status,'queued'),v."createdAt",v.visibility
      FROM "Video" v LEFT JOIN "User" u ON u.id=v."ownerId" LEFT JOIN "Job" j ON j."videoId"=v.id`;

    const where = `WHERE ($1='all' OR kind=$1) AND (title ILIKE $2 OR owner->>'name' ILIKE $2) AND ($3::timestamp IS NULL OR "createdAt">=$3::timestamp)`;

    const parameters = [
      status,
      containsPattern(q),
      period === 'all'
        ? null
        : new Date(Date.now() - Number(period) * 86_400_000),
    ];

    const [items, counts] = await Promise.all([
      this.db.query(
        `SELECT * FROM (${union}) materials ${where} ORDER BY "createdAt" DESC,id ASC OFFSET $4 LIMIT $5`,
        [...parameters, (page - 1) * limit, limit]
      ),
      this.db.query(
        `SELECT count(*)::int AS total FROM (${union}) materials ${where}`,
        parameters
      ),
    ]);

    const total = Number(counts[0].total);

    return { items, page, limit, total, hasMore: page * limit < total };
  }
  private async helperDetail(row: HelperProfile) {
    const user = await this.db.manager.findOneBy(User, { id: row.userId });

    return {
      userId: row.userId,
      name: user?.name ?? null,
      email: user?.email ?? null,
      languages: row.languages,
      materialIds: row.materialIds,
      canReview: row.canReview,
      canEdit: row.canEdit,
      canRequestEdit: row.canRequestEdit,
      active: row.active,
    };
  }
  async helpers() {
    const rows = await this.db.manager.find(HelperProfile, {
      order: { updatedAt: 'DESC' },
    });

    return {
      items: await Promise.all(rows.map((row) => this.helperDetail(row))),
    };
  }
  async saveHelper(userId: string, input: z.infer<typeof helperInputSchema>) {
    // 아직 로그인하지 않은 이메일로 실체 없는 도우미 권한이 생기는 것을 막는다.
    const user = await this.db
      .getRepository(User)
      .createQueryBuilder('u')
      .where('LOWER(u.email) = :email', { email: input.email })
      .getOne();

    if (!user)
      throw new HttpError(
        404,
        '먼저 서비스에 Google로 로그인한 계정만 도우미로 지정할 수 있습니다.'
      );
    if (input.canRequestEdit && !input.canReview)
      throw new HttpError(400, '수정 요청에는 검토 권한도 필요합니다.');
    if (input.canEdit && !input.canReview)
      throw new HttpError(400, '직접 수정에는 검토 권한도 필요합니다.');

    // 자료 배정은 원본 공개 동의가 아니라 질문을 담당할 범위의 지정이다.
    if (input.materialIds.length) {
      const [materials, videos] = await Promise.all([
        this.db.manager.findBy(Material, { id: In(input.materialIds) }),
        this.db.manager.findBy(Video, { id: In(input.materialIds) }),
      ]);

      if (
        new Set([...materials, ...videos].map((row) => row.id)).size !==
        input.materialIds.length
      )
        throw new HttpError(400, '존재하는 자료만 배정할 수 있습니다.');
    }

    const row = await this.db.transaction(async (tx) => {
      await tx.upsert(
        HelperProfile,
        {
          userId: user.id,
          languages: input.languages,
          materialIds: input.materialIds,
          canReview: input.canReview,
          canEdit: input.canEdit ?? false,
          canRequestEdit: input.canRequestEdit,
          active: input.active,
        },
        ['userId']
      );

      await this.questions.event(
        tx,
        userId,
        null,
        'helper_permissions_changed',
        `${input.email}: 언어 ${input.languages.join(', ')}, 자료 ${input.materialIds.length}개, 검토 ${input.canReview}, 수정 요청 ${input.canRequestEdit}, 활성 ${input.active}`
      );

      return tx.findOneByOrFail(HelperProfile, { userId: user.id });
    });

    return this.helperDetail(row);
  }
  async usage() {
    const jobs = await this.db.manager.find(Job, {
      order: { updatedAt: 'DESC' },
      take: 100,
    });

    const videos = new Map(
      (jobs.length
        ? await this.db.manager.findBy(Video, {
            id: In(jobs.map((j) => j.videoId)),
          })
        : []
      ).map((v) => [v.id, v])
    );

    return {
      items: jobs.map((j) => ({
        id: j.id,
        videoId: j.videoId,
        title: videos.get(j.videoId)?.title ?? '삭제된 영상',
        status: j.status,
        attempts: j.attempts,
        errorMessage: j.errorMessage,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        costKind: 'unavailable' as const,
        cost: null,
      })),
    };
  }
  async communityReports(query: HistoryQuery) {
    const { page, limit, status, period, q } = query;
    // 신고한 게시 내용만 조회하며 첨부 PDF 원본이나 개인 대화는 열지 않는다.
    const join = `FROM "CommunityReport" r JOIN "CommunityPost" p ON p.id=r."postId" LEFT JOIN "User" u ON u.id=r."reporterId"`;
    const where = `WHERE ($1='all' OR r.status=$1) AND (r.reason ILIKE $2 OR p.title ILIKE $2) AND ($3::timestamp IS NULL OR r."createdAt">=$3::timestamp)`;

    const params = [
      status,
      containsPattern(q),
      period === 'all'
        ? null
        : new Date(Date.now() - Number(period) * 86_400_000),
    ];

    const [items, counts] = await Promise.all([
      this.db.query(
        `SELECT r.id,r.reason,r.status,r.resolution,r."createdAt",r."updatedAt",
        jsonb_build_object('id',p.id,'title',p.title,'body',p.body,'language',p.language,'visibility',p.visibility,'hiddenAt',p."hiddenAt",'source',p.source) AS post,
        jsonb_build_object('id',u.id,'name',u.name) AS reporter ${join} ${where} ORDER BY r."createdAt" DESC,r.id OFFSET $4 LIMIT $5`,
        [...params, (page - 1) * limit, limit]
      ),
      this.db.query(`SELECT count(*)::int AS total ${join} ${where}`, params),
    ]);

    const total = Number(counts[0].total);

    return { items, page, limit, total, hasMore: page * limit < total };
  }
  async moderate(
    actorId: string,
    id: string,
    input: z.infer<typeof moderationInputSchema>
  ) {
    await this.db.transaction(async (tx) => {
      const reports: { postId: string; status: string; updatedAt: Date }[] =
        await tx.query(
          'SELECT "postId",status,"updatedAt" FROM "CommunityReport" WHERE id=$1 FOR UPDATE',
          [id]
        );

      const report = reports[0];

      if (!report) throw new HttpError(404, '게시물 신고를 찾을 수 없습니다.');
      if (report.updatedAt.getTime() !== Date.parse(input.expectedUpdatedAt))
        throw new HttpError(
          409,
          '신고가 변경되었습니다. 최신 상태를 다시 확인해 주세요.'
        );

      // 숨김 상태를 되돌릴 때도 원래 신고와 조치 이력을 보존한다.
      await tx.query(
        'UPDATE "CommunityPost" SET "hiddenAt"=CASE WHEN $1::boolean THEN COALESCE("hiddenAt",now()) ELSE NULL END WHERE id=$2',
        [input.hidden, report.postId]
      );

      await tx.query(
        'UPDATE "CommunityReport" SET status=$1,resolution=$2,"updatedAt"=clock_timestamp() WHERE id=$3',
        [input.status, input.resolution, id]
      );

      await this.questions.event(
        tx,
        actorId,
        null,
        'community_moderated',
        `게시물 ${report.postId} 신고 ${id}: ${report.status} → ${input.status}, ${input.hidden ? '숨김' : '노출'}: ${input.resolution}`
      );
    });

    return { ok: true };
  }
}
