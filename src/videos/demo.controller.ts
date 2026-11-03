import { Controller, Get, Inject } from '@nestjs/common';
import { demoYoutubeId, type DemoLesson } from './demo.js';
import { PrismaService } from '../database/prisma.service.js';

@Controller('demo')
/** 공개 요청은 고정 체험 영상에만 접근하며 개인 기록을 생성하지 않는다. */
export class DemoController {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  @Get()
  async lesson(): Promise<DemoLesson> {
    const video = await this.db.video.findUnique({
      where: { youtubeId: demoYoutubeId },
      select: {
        job: { select: { status: true } },
        segments: {
          where: { excluded: false },
          orderBy: { index: 'asc' },
          take: 5,
          select: { id: true, start: true, end: true, text: true },
        },
      },
    });

    const ready = video?.job?.status === 'ready' && video.segments.length > 0;

    return {
      youtubeId: demoYoutubeId,
      status: ready
        ? 'ready'
        : video?.job?.status === 'failed' || video?.job?.status === 'ready'
          ? 'failed'
          : 'preparing',
      segments: ready ? video.segments : [],
    };
  }
}
