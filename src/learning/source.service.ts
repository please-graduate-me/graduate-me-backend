import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { Material } from '../database/entities/Material.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { HttpError } from '../common/http-error.js';
import type { LearningSource, SourceInput } from './contracts.js';

/** PDF 줄바꿈과 영상 자막의 연속 공백 차이만 무시한다. */
export function normalizedExcerpt(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

@Injectable()
/** 질문과 표현 저장이 같은 원문 접근·발췌 검증을 사용하게 한다. */
export class SourceService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async resolve(userId: string, input: SourceInput): Promise<LearningSource> {
    let text: string;
    let source: LearningSource;

    if (input.kind === 'pdf') {
      const material = await this.db.manager.findOneBy(Material, {
        id: input.materialId,
        ownerId: userId,
      });

      if (!material || input.page > material.pages.length)
        throw new HttpError(404, '원문 자료를 찾을 수 없습니다.');
      text = material.pages[input.page - 1];
      source = { ...input, title: material.title, language: material.language };
    } else {
      const progress = await this.db.manager.findOneBy(Progress, {
        userId,
        videoId: input.videoId,
        archivedAt: IsNull(),
      });

      const segment =
        progress &&
        (await this.db.manager.findOneBy(Segment, {
          id: input.segmentId,
          videoId: input.videoId,
        }));

      const video =
        segment &&
        (await this.db.manager.findOneBy(Video, { id: input.videoId }));

      if (!segment || !video)
        throw new HttpError(404, '학습 원문을 찾을 수 없습니다.');
      text = segment.text;

      source = {
        ...input,
        title: video.title,
        language: 'en',
        start: segment.start,
        end: segment.end,
      };
    }

    if (!normalizedExcerpt(text).includes(normalizedExcerpt(input.quote)))
      throw new HttpError(400, '선택한 발췌를 원문에서 확인할 수 없습니다.');

    return source;
  }
}
