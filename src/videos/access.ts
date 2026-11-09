import type { DataSource } from 'typeorm';
import { Video } from '../database/entities/Video.entity.js';
import { HttpError } from '../common/http-error.js';

/** 과거 진도 보유 여부와 무관하게 현재 원본 접근 범위를 적용한다. */
export async function requireReadableVideo(
  db: Pick<DataSource, 'manager'>,
  userId: string,
  videoId: string
) {
  const video = await db.manager.findOneBy(Video, { id: videoId });

  if (
    !video ||
    (video.ownerId !== userId &&
      video.visibility !== 'public' &&
      !(
        video.visibility === 'accounts' && video.allowedUserIds.includes(userId)
      ))
  )
    throw new HttpError(404, '학습 영상을 찾을 수 없습니다.');

  return video;
}
