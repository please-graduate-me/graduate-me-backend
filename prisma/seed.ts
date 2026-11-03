import { PrismaClient } from '@prisma/client';
import { recommendations, demoYoutubeId } from '@graduate-me/shared';

const db = new PrismaClient();

async function main() {
  // 재시작으로 완료된 전사나 실패 기록을 덮어쓰지 않는다.
  const demo = await db.video.upsert({
    where: { youtubeId: demoYoutubeId },
    update: {},
    create: { youtubeId: demoYoutubeId, title: '홈 체험 영상' },
  });

  await db.job.upsert({
    where: { videoId: demo.id },
    update: {},
    create: { videoId: demo.id },
  });

  for (const item of recommendations)
    await db.video.upsert({
      where: { youtubeId: item.youtubeId },
      update: {},
      create: { youtubeId: item.youtubeId, title: item.title },
    });
}

main().finally(() => db.$disconnect());
