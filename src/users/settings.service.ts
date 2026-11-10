import { DataSource } from 'typeorm';
import { User } from '../database/entities/User.entity.js';
import { Inject, Injectable } from '@nestjs/common';
import type { LearningSettings } from './settings.js';
import { HttpError } from '../common/http-error.js';

/** 계정별 학습 옵션을 영상의 진도와 독립적으로 관리한다. */
@Injectable()
export class SettingsService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async get(userId: string) {
    const settings = await this.db.manager.findOne(User, {
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
    const result = await this.db.manager.update(User, { id: userId }, settings);

    if (!result.affected)
      throw new HttpError(404, '사용자를 찾을 수 없습니다.');

    return this.get(userId);
  }
}
