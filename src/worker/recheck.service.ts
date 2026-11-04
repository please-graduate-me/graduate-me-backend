import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Video } from '../database/entities/Video.entity.js';
import { Job } from '../database/entities/Job.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import type { ProcessorEvent } from './contracts.js';

/** 재검사 결과를 적용할 때 기존 답안과 구절 ID를 보존한다. */
@Injectable()
export class RecheckService {
  constructor(private readonly db: DataSource) {}

  async findVideo(youtubeId: string) {
    const video = await this.db.manager.findOneBy(Video, { youtubeId });

    if (!video) throw new Error('등록된 영상을 찾을 수 없습니다.');

    return video;
  }

  async apply(
    videoId: string,
    result: Extract<ProcessorEvent, { type: 'rechecked' }>,
    apply = false
  ) {
    return this.db.transaction(async (tx) => {
      // 학습 API와 같은 잠금 순서로 진도 저장과 재검사의 충돌을 막는다.
      const video = await tx.findOne(Video, {
        where: { id: videoId },
        lock: { mode: 'pessimistic_write' },
      });

      const job = await tx.findOneBy(Job, { videoId });

      if (!video || job?.status !== 'ready')
        throw new Error('처리가 완료된 영상만 재검사할 수 있습니다.');

      const old = await tx.find(Segment, {
        where: { videoId, excluded: false },
        order: { index: 'ASC' },
      });

      const excluded = new Set(
        old
          .filter((segment) => {
            const overlap = result.speechRegions.reduce(
              (sum, region) =>
                sum +
                Math.max(
                  0,
                  Math.min(segment.end, region.end) -
                    Math.max(segment.start, region.start)
                ),
              0
            );

            return (
              segment.end <= segment.start ||
              overlap / (segment.end - segment.start) < 0.25
            );
          })
          .map((segment) => segment.id)
      );

      if (excluded.size === old.length)
        throw new Error(
          '모든 구절이 제외 대상으로 판정되었습니다. 기존 기록을 유지합니다.'
        );

      const report = {
        검사: old.length,
        제외: excluded.size,
        유지: old.length - excluded.size,
        적용: apply,
      };

      if (!apply) return report;

      const progress = await tx.find(Progress, {
        where: { videoId },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });

      for (const item of progress) {
        const position = Math.max(0, Math.min(item.currentIndex, old.length));

        const currentIndex = old
          .slice(0, position)
          .filter((segment) => !excluded.has(segment.id)).length;

        await tx.update(Progress, item.id, { currentIndex });
      }

      for (const id of excluded) {
        await tx.update(Segment, id, {
          excluded: true,
          exclusionReason: 'NO_SPEECH_VAD',
        });
      }

      await tx.update(Video, videoId, {
        speechRegions: result.speechRegions,
        speechFilterVersion: result.filterVersion,
        speechCheckedAt: new Date(),
      });

      return report;
    });
  }
}
