import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, Not } from 'typeorm';
import type { z } from 'zod';
import { Material } from '../database/entities/Material.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { Job } from '../database/entities/Job.entity.js';
import { HelperProfile } from '../database/entities/HelperProfile.entity.js';
import { LearningQuestion } from '../database/entities/LearningQuestion.entity.js';
import { ReviewRequest } from '../database/entities/ReviewRequest.entity.js';
import { User } from '../database/entities/User.entity.js';
import { QuestionsService } from '../learning/questions.service.js';
import { HttpError } from '../common/http-error.js';
import type { helperInputSchema } from './workspace-contracts.js';

@Injectable()
/** 운영 집계는 저장된 기록만 사용하고 미측정 비용을 추정하지 않는다. */
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
  async materials() {
    const [materials, videos, jobs] = await Promise.all([
      this.db.manager.find(Material, {
        select: {
          id: true,
          title: true,
          language: true,
          ownerId: true,
          pages: true,
          createdAt: true,
        },
        order: { createdAt: 'DESC' },
        take: 100,
      }),
      this.db.manager.find(Video, { order: { createdAt: 'DESC' }, take: 100 }),
      this.db.manager.find(Job),
    ]);

    const owners = new Map(
      (materials.length
        ? await this.db.manager.findBy(User, {
            id: In(materials.map((m) => m.ownerId)),
          })
        : []
      ).map((u) => [u.id, u])
    );

    const statuses = new Map(jobs.map((j) => [j.videoId, j.status]));

    return {
      items: [
        ...materials.map((m) => ({
          id: m.id,
          title: m.title,
          kind: 'pdf' as const,
          language: m.language,
          owner: { id: m.ownerId, name: owners.get(m.ownerId)?.name ?? null },
          pageCount: m.pages.length,
          duration: null,
          status: 'ready',
          createdAt: m.createdAt,
        })),
        ...videos.map((v) => ({
          id: v.id,
          title: v.title,
          kind: 'video' as const,
          language: 'en' as const,
          owner: null,
          pageCount: null,
          duration: v.duration,
          status: statuses.get(v.id) ?? 'queued',
          createdAt: v.createdAt,
        })),
      ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    };
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
}
