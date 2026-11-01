import { PrismaClient } from '@prisma/client';
import { recommendations } from '@tubedict/shared';
const db = new PrismaClient();
async function main() {
  for (const item of recommendations)
    await db.video.upsert({
      where: { youtubeId: item.youtubeId },
      update: {},
      create: { youtubeId: item.youtubeId, title: item.title },
    });
}
main().finally(() => db.$disconnect());
