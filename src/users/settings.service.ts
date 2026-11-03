import { Inject, Injectable } from '@nestjs/common';
import type { LearningSettings } from './settings.js';
import { PrismaService } from '../database/prisma.service.js';
import { HttpError } from '../common/http-error.js';

@Injectable()
/** 계정별 학습 옵션을 영상의 진도와 독립적으로 관리한다. */
export class SettingsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async get(userId: string) {
    const settings = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        autoReplay: true,
        replayDelay: true,
        replayCount: true,
        playbackRate: true,
      },
    });

    if (!settings) throw new HttpError(404, '사용자를 찾을 수 없습니다.');

    return settings;
  }
  async update(userId: string, settings: LearningSettings) {
    return this.db.user.update({
      where: { id: userId },
      data: settings,
      select: {
        autoReplay: true,
        replayDelay: true,
        replayCount: true,
        playbackRate: true,
      },
    });
  }
}
