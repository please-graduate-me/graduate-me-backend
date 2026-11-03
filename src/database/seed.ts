import dataSource from './data-source.js';
import { Video } from './entities/Video.entity.js';
import { Job } from './entities/Job.entity.js';
import { recommendations } from '../videos/catalog.js';
import { demoYoutubeId } from '../videos/demo.js';

try {
  await dataSource.initialize();

  await dataSource.transaction(async (tx) => {
    // 재시작으로 완료된 전사나 실패 기록을 덮어쓰지 않는다.
    await tx
      .createQueryBuilder()
      .insert()
      .into(Video)
      .values({ youtubeId: demoYoutubeId, title: '홈 체험 영상' })
      .orIgnore()
      .execute();

    const demo = await tx.findOneByOrFail(Video, { youtubeId: demoYoutubeId });

    await tx
      .createQueryBuilder()
      .insert()
      .into(Job)
      .values({ videoId: demo.id })
      .orIgnore()
      .execute();

    for (const item of recommendations)
      await tx
        .createQueryBuilder()
        .insert()
        .into(Video)
        .values({ youtubeId: item.youtubeId, title: item.title })
        .orIgnore()
        .execute();
  });
} finally {
  if (dataSource.isInitialized) await dataSource.destroy();
}
