import { DataSource } from 'typeorm';
import { Video } from '../database/entities/Video.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { Controller, Get, Inject } from '@nestjs/common';
import { demoYoutubeId, type DemoLesson } from './demo.js';
import { learningUnits } from './grading.js';

@Controller('demo')
/** 공개 요청은 고정 체험 영상에만 접근하며 개인 기록을 생성하지 않는다. */
export class DemoController {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  @Get()
  async lesson(): Promise<DemoLesson> {
    const video = await this.db.manager.findOne(Video, {
      where: {
        youtubeId: demoYoutubeId,
        language: 'en',
        analysisVersion: 'v1',
        visibility: 'public',
      },
      relations: { job: true },
      select: { id: true, job: { status: true } },
    });

    const segments = video
      ? await this.db.manager.find(Segment, {
          where: { videoId: video.id },
          order: { index: 'ASC' },
          take: 10,
          select: {
            id: true,
            start: true,
            end: true,
            text: true,
            translation: true,
            blankCandidates: true,
            version: true,
          },
        })
      : [];

    const ready = video?.job?.status === 'ready' && segments.length > 0;

    return {
      youtubeId: demoYoutubeId,
      status: ready
        ? 'ready'
        : video?.job?.status === 'failed' || video?.job?.status === 'ready'
          ? 'failed'
          : 'preparing',
      segments: ready
        ? segments.map((segment) => ({
            ...segment,
            translation: segment.translation ?? null,
            blankCandidates: segment.blankCandidates ?? null,
            version: segment.version ?? 1,
            units: learningUnits(segment.text, 'en'),
          }))
        : [],
    };
  }
}
