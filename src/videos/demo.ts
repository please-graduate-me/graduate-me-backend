import { z } from 'zod';

/** 공개 체험 대상으로 지정한 영상만 조회한다. */
export const demoYoutubeId = 'VHZI9_we5GQ';

/** 개인 정보 없이 체험에 필요한 문장과 재생 구간만 전달한다. */
export const demoLessonSchema = z.object({
  youtubeId: z.literal(demoYoutubeId),
  status: z.enum(['preparing', 'ready', 'failed']),
  segments: z.array(
    z.object({
      id: z.string(),
      start: z.number(),
      end: z.number(),
      text: z.string(),
    })
  ),
});

/** 체험 화면의 입력을 서버 계약과 일치시킨다. */
export type DemoLesson = z.infer<typeof demoLessonSchema>;
