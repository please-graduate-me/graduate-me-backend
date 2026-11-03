import { z } from 'zod';

/** 동일 생성 요청의 재전송이 공유 링크를 중복 생성하지 않게 한다. */
export const createShareSchema = z.object({
  requestId: z.uuid(),
  videoId: z.string().min(1),
  segmentId: z.string().min(1).optional(),
});

/** 방문 재시도와 새로고침을 동일 탭 세션으로 묶는다. */
export const shareVisitSchema = z.object({ visitId: z.uuid() });

/** 공유 경로를 외부 주소로 오인하지 않도록 서버가 상대 경로를 반환한다. */
export const createdShareSchema = z.object({
  id: z.uuid(),
  path: z.string().startsWith('/share/'),
});

/** 공유 페이지에는 개인 학습 기록과 공유자의 개인정보를 보내지 않는다. */
export const sharedLessonSchema = z.object({
  id: z.uuid(),
  video: z.object({
    id: z.string(),
    youtubeId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/),
    title: z.string(),
    duration: z.number().nullable(),
    category: z.string().nullable(),
  }),
  segment: z
    .object({ id: z.string(), start: z.number(), end: z.number() })
    .nullable(),
});

/** 공유 진입 화면이 공유 응답 계약을 사용하게 한다. */
export type SharedLesson = z.infer<typeof sharedLessonSchema>;

/** 공유로 학습을 시작한 뒤 개인 학습 화면으로 이동한다. */
export const shareStartResultSchema = z.object({ videoId: z.string() });
