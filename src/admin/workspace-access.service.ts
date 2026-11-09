import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HelperProfile } from '../database/entities/HelperProfile.entity.js';
import { User } from '../database/entities/User.entity.js';
import type { LearningSource } from '../learning/contracts.js';
import { AdminService } from './admin.service.js';
import { HttpError } from '../common/http-error.js';

/** 배정이 남아 있어도 현재 언어·자료 권한을 잃으면 접근을 차단한다. */
export function helperCanAccess(
  profile: HelperProfile | null,
  source: LearningSource
) {
  const id = source.kind === 'pdf' ? source.materialId : source.videoId;

  return Boolean(
    profile?.active &&
    profile.languages.includes(source.language) &&
    profile.materialIds.includes(id)
  );
}

@Injectable()
/** 학생과 별도인 admin 앱의 역할과 담당 범위를 서버에서 판정한다. */
export class WorkspaceAccessService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(AdminService) private readonly admin: AdminService
  ) {}
  async access(userId: string) {
    const user = await this.db.manager.findOneBy(User, { id: userId });

    if (!user) throw new HttpError(401, '로그인이 필요합니다.');

    const [isAdmin, profile] = await Promise.all([
      this.admin.allowed(userId),
      this.db.manager.findOneBy(HelperProfile, { userId }),
    ]);

    return {
      role: isAdmin
        ? ('admin' as const)
        : profile?.active
          ? ('helper' as const)
          : null,
      user: { id: user.id, name: user.name, email: user.email },
      languages: isAdmin
        ? ['en', 'th']
        : profile?.active
          ? profile.languages
          : [],
      materialIds: profile?.active ? profile.materialIds : [],
      canReview: isAdmin || Boolean(profile?.active && profile.canReview),
      canRequestEdit:
        isAdmin || Boolean(profile?.active && profile.canRequestEdit),
    };
  }
  async require(userId: string) {
    const access = await this.access(userId);

    if (!access.role)
      throw new HttpError(
        403,
        '답변 도우미 또는 운영 관리자 권한이 필요합니다.'
      );

    return access;
  }
  async profile(userId: string) {
    return this.db.manager.findOneBy(HelperProfile, { userId });
  }
  async canAssign(userId: string, source: LearningSource) {
    return helperCanAccess(await this.profile(userId), source);
  }
}
