import { materialPolicy } from '../learning/material-policy.js';
import { z } from 'zod';
import { ProcessingError } from './contracts.js';
import { googleJson } from './google-http.js';

const metadataSchema = z.object({
  items: z.array(
    z.object({
      snippet: z.object({
        title: z.string().trim().min(1),
        categoryId: z.string(),
        liveBroadcastContent: z.string(),
      }),
      contentDetails: z.object({
        duration: z.string(),
        contentRating: z.object({ ytRating: z.string().optional() }).optional(),
      }),
      status: z.object({ privacyStatus: z.string(), embeddable: z.boolean() }),
    })
  ),
});

/** 분석 비용을 쓰기 전에 공식 메타데이터로 공개 여부와 길이를 확인한다. */
export async function youtubeMetadata(
  youtubeId: string,
  key: string,
  signal: AbortSignal
) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');

  url.search = new URLSearchParams({
    part: 'snippet,contentDetails,status',
    id: youtubeId,
  }).toString();

  const data = metadataSchema.parse(
    await googleJson(
      url,
      {
        headers: { 'x-goog-api-key': key },
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      },
      'YOUTUBE'
    )
  );

  const video = data.items[0];

  if (
    !video ||
    video.status.privacyStatus !== 'public' ||
    !video.status.embeddable ||
    video.snippet.liveBroadcastContent !== 'none' ||
    video.contentDetails.contentRating?.ytRating === 'ytAgeRestricted'
  ) {
    throw new ProcessingError(
      'UNSUPPORTED_VIDEO',
      '재생 가능한 공개 일반 영상만 지원합니다.'
    );
  }

  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(
    video.contentDetails.duration
  );

  const duration = match
    ? Number(match[1] ?? 0) * 3600 +
      Number(match[2] ?? 0) * 60 +
      Number(match[3] ?? 0)
    : 0;

  const maximum = materialPolicy().video.maxSeconds;

  if (duration <= 0 || duration > maximum) {
    throw new ProcessingError(
      'UNSUPPORTED_DURATION',
      `${maximum / 60}분 이하의 영상만 지원합니다.`
    );
  }

  let category: string | null = null;

  try {
    const categoriesUrl = new URL(
      'https://www.googleapis.com/youtube/v3/videoCategories'
    );

    categoriesUrl.search = new URLSearchParams({
      part: 'snippet',
      id: video.snippet.categoryId,
      hl: 'ko',
    }).toString();

    const categories = z
      .object({
        items: z.array(
          z.object({ snippet: z.object({ title: z.string().min(1) }) })
        ),
      })
      .parse(
        await googleJson(
          categoriesUrl,
          {
            headers: { 'x-goog-api-key': key },
            signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
          },
          'YOUTUBE'
        )
      );

    category = categories.items[0]?.snippet.title ?? null;
  } catch {
    // 보조 분류 조회 실패는 정상 영상의 분석을 막지 않는다.
    signal.throwIfAborted();
  }

  return {
    title: video.snippet.title,
    duration,
    category,
    youtubeCategoryId: video.snippet.categoryId,
  };
}
