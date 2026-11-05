import { readFileSync } from 'node:fs';
import dataSource from './data-source.js';
import { Video } from './entities/Video.entity.js';
import { Segment } from './entities/Segment.entity.js';
import { Job } from './entities/Job.entity.js';
import { demoLessonSchema } from '../videos/demo.js';

const lesson = demoLessonSchema.parse(JSON.parse(readFileSync(0, 'utf8')));

if (lesson.status !== 'ready' || !lesson.segments.length)
  throw new Error('준비된 체험 자료만 가져올 수 있습니다.');

try {
  await dataSource.initialize();

  await dataSource.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      lesson.youtubeId,
    ]);

    const video = await tx.findOneByOrFail(Video, {
      youtubeId: lesson.youtubeId,
    });

    // 기존 사용자 기록이 연결된 구절은 배포로 교체하지 않는다.
    if (await tx.count(Segment, { where: { videoId: video.id } })) return;

    await tx.insert(
      Segment,
      lesson.segments.slice(0, 10).map((segment, index) => ({
        videoId: video.id,
        index,
        start: segment.start,
        end: segment.end,
        text: segment.text,
        words: [],
      }))
    );

    await tx.update(Job, { videoId: video.id }, { status: 'ready' });
  });
} finally {
  if (dataSource.isInitialized) await dataSource.destroy();
}
