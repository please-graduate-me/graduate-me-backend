import { z } from 'zod';

/** 수업 생성은 학과 공식 개설·학교 계정 연동과 구분한다. */
export const courseInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  language: z.enum(['en', 'th']),
});

/** 가입 코드는 로그인한 학생이 명시적으로 입력한다. */
export const courseJoinSchema = z.object({ inviteCode: z.uuid() });

/** 수업 담당자가 기존 계정을 수강생 또는 조교로 지정한다. */
export const courseMemberSchema = z.object({
  userId: z.string().min(1).max(128),
  role: z.enum(['assistant', 'student']),
});

/** 과제는 준비된 원본 범위와 제출 정책을 고정해 버전으로 보존한다. */
export const assignmentInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    videoId: z.string().min(1).max(128).optional(),
    materialId: z.string().min(1).max(128).optional(),
    fromIndex: z.number().int().min(0),
    toIndex: z.number().int().min(0),
    mode: z.enum(['full', 'blank', 'reading']),
    blankRatio: z
      .union([z.literal(20), z.literal(40), z.literal(60)])
      .default(20),
    dueAt: z.iso.datetime(),
    allowLate: z.boolean(),
    allowResubmit: z.boolean(),
    allowHints: z.boolean(),
    revealAfterSubmit: z.boolean(),
  })
  .refine(
    (v) => Boolean(v.videoId) !== Boolean(v.materialId),
    '영상 또는 PDF를 하나만 선택해 주세요.'
  )
  .refine(
    (v) => v.toIndex >= v.fromIndex && v.toIndex - v.fromIndex < 30,
    '최대 30개 구절·페이지 범위를 선택해 주세요.'
  )
  .refine(
    (v) => (v.materialId ? v.mode === 'reading' : v.mode !== 'reading'),
    'PDF는 읽기 응답, 영상은 받아쓰기로 배정해 주세요.'
  );

/** 수정 이유와 기대 버전을 함께 받아 이미 제출된 과제의 기준을 보존한다. */
export const assignmentUpdateSchema = assignmentInputSchema.safeExtend({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
});

/** 재전송 식별자와 당시 버전으로 개인 학습과 별도인 최종 제출을 기록한다. */
export const assignmentSubmitSchema = z.object({
  requestId: z.uuid(),
  version: z.number().int().positive(),
  answers: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        answer: z.union([
          z.string().max(20000),
          z.array(z.string().max(500)).max(500),
        ]),
      })
    )
    .min(1)
    .max(30),
});

/** 과제 힌트도 사용자와 당시 과제·구절 버전에 연결한다. */
export const assignmentHintSchema = z.object({
  version: z.number().int().positive(),
  taskId: z.string().min(1).max(128),
});
