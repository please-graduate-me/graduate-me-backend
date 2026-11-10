import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { ExpressionsService } from '../learning/expressions.service.js';
import { Expression } from '../database/entities/Expression.entity.js';
import { PracticeAttempt } from '../database/entities/PracticeAttempt.entity.js';
import { ProfileService } from '../users/profile.service.js';
import { MaterialsService } from '../learning/materials.service.js';
import { MaterialAccess } from '../database/entities/MaterialAccess.entity.js';
import { DataSource, In } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { Job } from '../database/entities/Job.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import { Attempt } from '../database/entities/Attempt.entity.js';
import { SourceService } from '../learning/source.service.js';
import { CoursesService } from './courses.service.js';
import { CommunityService } from '../community/community.service.js';
import { InsightsService } from '../insights/insights.service.js';
import { assignmentInputSchema, assignmentSubmitSchema } from './contracts.js';
import {
  communityPostSchema,
  communityQuerySchema,
} from '../community/contracts.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('확장 학습의 실제 기록·수업·공개 권한 경계', () => {
  const db = new DataSource(databaseOptions(testUrl));

  const courses = new CoursesService(db),
    community = new CommunityService(db, new SourceService(db)),
    insights = new InsightsService(db);

  const teacher = randomUUID(),
    student = randomUUID(),
    outsider = randomUUID(),
    assistant = randomUUID();

  const videoId = randomUUID(),
    privateVideoId = randomUUID(),
    segmentId = randomUUID();

  const otherSegmentId = randomUUID();

  let courseId: string, assignmentId: string;
  const materialIds: string[] = [];

  const input = () =>
    assignmentInputSchema.parse({
      title: '개인 기록과 분리된 과제',
      videoId,
      fromIndex: 0,
      toIndex: 0,
      mode: 'full',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      allowLate: false,
      allowResubmit: false,
      allowHints: true,
      revealAfterSubmit: false,
    });

  beforeAll(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('실제 외부 요청 금지');
      })
    );

    await db.initialize();
    await db.runMigrations();

    await db.manager.insert(User, [
      { id: teacher, name: '교사' },
      { id: student, name: '학생', interests: ['Learning'] },
      { id: outsider },
      { id: assistant },
    ]);

    await db.manager.insert(Video, [
      {
        id: videoId,
        youtubeId: randomUUID().replaceAll('-', '').slice(0, 11),
        title: 'Learning English',
        language: 'en',
        visibility: 'public',
        blankStatus: 'ready',
      },
      {
        id: privateVideoId,
        youtubeId: randomUUID().replaceAll('-', '').slice(0, 11),
        title: '비공개',
        ownerId: teacher,
        language: 'en',
        visibility: 'private',
      },
    ]);

    await db.manager.insert(Job, [
      { videoId, status: 'ready' },
      { videoId: privateVideoId, status: 'ready' },
    ]);

    await db.manager.insert(Segment, [
      {
        id: segmentId,
        videoId,
        index: 0,
        start: 0,
        end: 2,
        text: 'Learning is a journey.',
        words: [],
        blankCandidates: [0],
      },
      {
        id: otherSegmentId,
        videoId,
        index: 1,
        start: 3,
        end: 5,
        text: 'Another sentence.',
        words: [],
        blankCandidates: [0],
      },
      {
        videoId: privateVideoId,
        index: 0,
        start: 0,
        end: 2,
        text: 'Private learning.',
        words: [],
      },
    ]);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();

    if (db.isInitialized) {
      if (materialIds.length)
        await db.manager.delete(MaterialAccess, { id: In(materialIds) });
      await db.manager.delete(Video, { id: In([videoId, privateVideoId]) });

      await db.manager.delete(User, {
        id: In([teacher, student, outsider, assistant]),
      });

      await db.destroy();
    }
  });

  it('초대 가입은 학생 역할만 주고 수업별 구성원·권한을 분리한다', async () => {
    courseId = (
      await courses.create(teacher, { title: '독립 수업', language: 'en' })
    ).id;

    const detail = await courses.detail(teacher, courseId);

    await courses.join(student, String(detail.course.inviteCode));

    await courses.member(teacher, courseId, {
      userId: assistant,
      role: 'assistant',
    });

    expect((await courses.detail(student, courseId)).course.role).toBe(
      'student'
    );

    expect((await courses.detail(student, courseId)).course).not.toHaveProperty(
      'inviteCode'
    );

    expect((await courses.detail(student, courseId)).members).toHaveLength(1);

    await expect(courses.detail(outsider, courseId)).rejects.toMatchObject({
      status: 404,
    });

    await expect(
      courses.member(assistant, courseId, { userId: outsider, role: 'student' })
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      courses.assign(student, courseId, input())
    ).rejects.toMatchObject({ status: 404 });

    assignmentId = (await courses.assign(assistant, courseId, input())).id;

    await db.manager.update(
      Segment,
      { id: segmentId },
      { blankCandidates: [] }
    );

    await expect(
      courses.assign(teacher, courseId, { ...input(), mode: 'blank' })
    ).rejects.toMatchObject({ status: 400 });

    await db.manager.update(
      Segment,
      { id: segmentId },
      { blankCandidates: [0] }
    );
  });

  it('제출전 정답을 숨기고 힌트·중복제출·제출정책을 개인 진도와 분리한다', async () => {
    const detail = await courses.getAssignment(student, courseId, assignmentId);

    expect(detail.source.tasks[0].text).toBeNull();
    expect(detail.source.tasks[0].units).toEqual([]);
    expect(detail.source.youtubeId).toBeTruthy();
    expect(detail.source.fromIndex).toBe(0);

    expect(
      await courses.hint(student, courseId, assignmentId, 1, segmentId)
    ).toMatchObject({ hintCount: 1 });

    const submission = assignmentSubmitSchema.parse({
      requestId: randomUUID(),
      version: 1,
      answers: [{ id: segmentId, answer: 'Learning is a journey.' }],
    });

    const first = await courses.submit(
      student,
      courseId,
      assignmentId,
      submission
    );

    expect(first).toMatchObject({
      result: [{ correct: true, hintCount: 1 }],
      late: false,
      version: 1,
    });

    expect(first.assignmentSnapshot).not.toHaveProperty('source');

    expect((first.result as Record<string, unknown>[])[0]).not.toHaveProperty(
      'expected',
      'Learning is a journey.'
    );

    expect(
      await courses.submit(student, courseId, assignmentId, submission)
    ).toMatchObject({ id: first.id });

    await expect(
      courses.submit(student, courseId, assignmentId, {
        ...submission,
        answers: [...submission.answers, ...submission.answers],
      })
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      courses.submit(student, courseId, assignmentId, {
        ...submission,
        requestId: randomUUID(),
      })
    ).rejects.toMatchObject({ status: 409 });

    expect(
      await db.manager.countBy(Progress, { userId: student, videoId })
    ).toBe(0);

    const multi = await courses.assign(teacher, courseId, {
      ...input(),
      toIndex: 1,
    });

    const multiInput = {
      requestId: randomUUID(),
      version: 1,
      answers: [
        { id: segmentId, answer: 'Learning is a journey.' },
        { id: otherSegmentId, answer: 'Another sentence.' },
      ],
    };

    await courses.submit(student, courseId, multi.id, multiInput);

    await expect(
      courses.submit(student, courseId, multi.id, {
        ...multiInput,
        answers: multiInput.answers.slice(0, 1),
      })
    ).rejects.toMatchObject({ status: 409 });

    const staff = await courses.getAssignment(teacher, courseId, assignmentId);

    expect(staff.submissions[0]).toMatchObject({
      result: [{ expected: 'Learning is a journey.' }],
    });
  });

  it('과제 변경은 새 버전에 연결하며 과거 제출의 정답과 기한정책을 보존한다', async () => {
    const updated = {
      ...input(),
      dueAt: new Date(Date.now() - 1000).toISOString(),
      expectedVersion: 1,
      reason: '기한 조정',
      allowLate: true,
      allowResubmit: true,
      revealAfterSubmit: true,
    };

    expect(
      await courses.assign(teacher, courseId, updated, assignmentId, updated)
    ).toMatchObject({ version: 2 });

    await expect(
      courses.submit(student, courseId, assignmentId, {
        requestId: randomUUID(),
        version: 1,
        answers: [{ id: segmentId, answer: 'wrong' }],
      })
    ).rejects.toMatchObject({ status: 409 });

    const result = await courses.submit(student, courseId, assignmentId, {
      requestId: randomUUID(),
      version: 2,
      answers: [{ id: segmentId, answer: 'wrong' }],
    });

    expect(result).toMatchObject({
      late: true,
      version: 2,
      result: [{ correct: false, expected: 'Learning is a journey.' }],
    });

    const detail = await courses.getAssignment(teacher, courseId, assignmentId);

    expect(detail.submissions).toHaveLength(2);
    expect(detail.revisions).toHaveLength(2);

    const studentDetail = await courses.getAssignment(
      student,
      courseId,
      assignmentId
    );

    expect(studentDetail.revisions).toHaveLength(2);
    expect(studentDetail.revisions[0]).not.toHaveProperty('actorId');

    await db.manager.update(
      Video,
      { id: videoId },
      { visibility: 'private', ownerId: teacher }
    );

    const revoked = await courses.getAssignment(
      student,
      courseId,
      assignmentId
    );

    expect(revoked.sourceAvailable).toBe(false);
    expect(revoked.source.tasks).toEqual([]);
    expect(revoked.submissions).toHaveLength(2);

    await db.manager.update(Video, { id: videoId }, { visibility: 'public' });
  });

  it('PDF 읽기 과제도 원본 권한과 서술 응답을 별도로 보존한다', async () => {
    const pdf = await PDFDocument.create();

    pdf.addPage([600, 800]);

    const material = await new MaterialsService(db).create(teacher, {
      title: '읽기 자료',
      language: 'en',
      filename: 'read.pdf',
      pages: ['Read and explain this passage.'],
      contentBase64: Buffer.from(await pdf.save()).toString('base64'),
    });

    materialIds.push(material.id);

    const assignment = await courses.assign(
      teacher,
      courseId,
      assignmentInputSchema.parse({
        ...input(),
        videoId: undefined,
        materialId: material.id,
        mode: 'reading',
      })
    );

    expect(
      await courses.getAssignment(student, courseId, assignment.id)
    ).toMatchObject({ sourceAvailable: false, source: { tasks: [] } });

    await db.manager.update(
      MaterialAccess,
      { id: material.id },
      { visibility: 'accounts', allowedUserIds: [student] }
    );

    const detail = await courses.getAssignment(
      student,
      courseId,
      assignment.id
    );

    expect(detail.source.tasks[0]).toMatchObject({
      page: 1,
      text: 'Read and explain this passage.',
    });

    const submission = await courses.submit(student, courseId, assignment.id, {
      requestId: randomUUID(),
      version: 1,
      answers: [{ id: '1', answer: 'My own reading response.' }],
    });

    expect(submission).toMatchObject({ result: [{ correct: null }] });
  });

  it('커뮤니티는 명시한 공개 대상만 글·댓글을 읽으며 개인 원본 권한을 부여하지 않는다', async () => {
    const post = await community.create(
      teacher,
      communityPostSchema.parse({
        title: '선택한 대상',
        body: '공유 본문',
        language: 'en',
        visibility: 'accounts',
        allowedUserIds: [student],
      })
    );

    expect(
      await community.create(
        teacher,
        communityPostSchema.parse({
          title: '수정한 제목',
          body: '수정 본문',
          language: 'en',
          visibility: 'accounts',
          allowedUserIds: [student],
        }),
        post.id
      )
    ).toMatchObject({ id: post.id, title: '수정한 제목' });

    await community.comment(student, post.id, '허용된 답글');
    await community.react(student, post.id, true);
    await community.react(student, post.id, true);
    await community.follow(student, teacher, true);

    expect(await community.get(student, post.id)).toMatchObject({
      likes: 1,
      following: true,
      allowedUserIds: [],
    });

    expect(
      (
        await community.list(
          student,
          communityQuerySchema.parse({ following: 'true' })
        )
      ).items
    ).toHaveLength(1);

    await expect(community.get(outsider, post.id)).rejects.toMatchObject({
      status: 404,
    });

    await expect(
      community.comment(outsider, post.id, '금지')
    ).rejects.toMatchObject({ status: 404 });

    await expect(community.remove(student, post.id)).rejects.toMatchObject({
      status: 403,
    });

    const report = await community.report(
      student,
      post.id,
      '공개 내용 검토가 필요합니다.'
    );

    expect(await community.report(student, post.id, '중복 신고')).toEqual(
      report
    );

    await db.query('UPDATE "CommunityPost" SET "hiddenAt"=now() WHERE id=$1', [
      post.id,
    ]);

    await expect(community.get(student, post.id)).rejects.toMatchObject({
      status: 404,
    });

    await expect(
      community.comment(student, post.id, '숨김 후 댓글')
    ).rejects.toMatchObject({ status: 404 });

    expect(
      (await community.list(student, communityQuerySchema.parse({}))).items
    ).toHaveLength(0);

    expect(await community.get(teacher, post.id)).toHaveProperty('hiddenAt');
    await community.remove(teacher, post.id);

    await expect(community.get(student, post.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('실제 답안만 약점 근거로 쓰고 언어·힌트·정답 열람을 분리한다', async () => {
    const progress = await db.manager.save(Progress, {
      userId: student,
      videoId,
    });

    await db.manager.insert(Attempt, [
      {
        id: randomUUID(),
        progressId: progress.id,
        segmentId,
        mode: 'full',
        answer: 'wrong',
        correct: false,
        result: {
          sourceText: 'Learning is a journey.',
          sourceVersion: 1,
          hintCount: 0,
          revealed: false,
        },
      },
      {
        id: randomUUID(),
        progressId: progress.id,
        segmentId,
        mode: 'full',
        answer: 'wrong again',
        correct: false,
        result: {
          sourceText: 'Learning is a journey.',
          sourceVersion: 1,
          hintCount: 1,
          revealed: false,
        },
      },
      {
        id: randomUUID(),
        progressId: progress.id,
        segmentId,
        mode: 'full',
        answer: 'Learning is a journey.',
        correct: true,
        result: {
          sourceText: 'Learning is a journey.',
          sourceVersion: 1,
          hintCount: 0,
          revealed: false,
        },
      },
    ]);

    const report = await insights.report(student, 'en', 30);

    expect(report).toMatchObject({
      sampleSize: 3,
      unassistedSamples: 2,
      excludedAssisted: 1,
      accuracy: 50,
      insufficientData: true,
    });

    expect(report.review[0]).toMatchObject({
      mistakes: 1,
      evidence: { correct: false },
    });

    expect((await insights.report(student, 'th', 30)).sampleSize).toBe(0);
    expect((await insights.report(outsider, 'en', 30)).sampleSize).toBe(0);
  });

  it('자가점검 저장 재전송은 같은 시도를 반환하고 다른 답안의 요청 재사용을 거부한다', async () => {
    const expression = await db.manager.save(Expression, {
      ownerId: student,
      text: 'Learning',
      meaning: '학습',
      note: '',
      source: {
        kind: 'video',
        videoId,
        segmentId,
        version: 1,
        quote: 'Learning',
        title: 'Learning English',
        language: 'en',
      },
    });

    const service = new ExpressionsService(db, new SourceService(db));

    const input = {
      requestId: randomUUID(),
      expressionId: expression.id,
      answer: '학습',
      correct: true,
      mode: 'self' as const,
    };

    const first = await service.practice(student, input);

    expect(await service.practice(student, input)).toMatchObject({
      id: first.id,
    });

    expect(await db.manager.countBy(PracticeAttempt, { id: first.id })).toBe(1);

    await expect(
      service.practice(student, { ...input, answer: '다른 답변' })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('추천은 준비·원본 ACL·언어·관심 없음 선택을 실제 적용한다', async () => {
    const list = await insights.recommendations(student, 'en');

    expect(list.items.map((i) => i.id)).toContain(videoId);
    expect(list.items.map((i) => i.id)).not.toContain(privateVideoId);

    expect(list.items.find((i) => i.id === videoId)?.reason).toContain(
      'Learning'
    );

    const requestId = randomUUID();

    await insights.event(student, videoId, requestId, 'shown');
    await insights.event(student, videoId, requestId, 'shown');

    expect(
      await db.query('SELECT id FROM "RecommendationEvent" WHERE id=$1', [
        requestId,
      ])
    ).toHaveLength(1);

    await insights.feedback(student, videoId, false);

    expect(
      (await insights.recommendations(student, 'en')).items.map((i) => i.id)
    ).not.toContain(videoId);

    expect((await insights.recommendations(student, 'th')).items).toEqual([]);
  });

  it('교사 탈퇴 후에도 수업·다른 학생 제출·당시 버전은 남고 새 초대 가입은 중지한다', async () => {
    const departed = randomUUID();

    await db.manager.insert(User, { id: departed });

    const course = await courses.create(departed, {
      title: '개설자 탈퇴 보존 검증',
      language: 'en',
    });

    const before = await courses.detail(departed, course.id);

    await courses.join(student, String(before.course.inviteCode));
    const pdf = await PDFDocument.create();

    pdf.addPage([600, 800]);

    const material = await new MaterialsService(db).create(departed, {
      title: '탈퇴 계정 읽기 자료',
      language: 'en',
      filename: 'source.pdf',
      pages: ['Read this historical source.'],
      contentBase64: Buffer.from(await pdf.save()).toString('base64'),
    });

    await db.manager.update(
      MaterialAccess,
      { id: material.id },
      { visibility: 'accounts', allowedUserIds: [student] }
    );

    const assignment = await courses.assign(
      departed,
      course.id,
      assignmentInputSchema.parse({
        ...input(),
        videoId: undefined,
        materialId: material.id,
        mode: 'reading',
        revealAfterSubmit: true,
      })
    );

    const saved = await courses.submit(student, course.id, assignment.id, {
      requestId: randomUUID(),
      version: 1,
      answers: [{ id: '1', answer: '보존할 개인 제출' }],
    });

    await new ProfileService(db).remove(departed);

    expect((await courses.detail(student, course.id)).course).toMatchObject({
      ownerUnavailable: true,
    });

    expect(
      (await courses.list(student)).items.some((item) => item.id === course.id)
    ).toBe(true);

    const preserved = await courses.getAssignment(
      student,
      course.id,
      assignment.id
    );

    expect(preserved).toMatchObject({
      sourceAvailable: false,
      source: { tasks: [] },
      submissions: [
        { id: saved.id, answers: [{ answer: '보존할 개인 제출' }], version: 1 },
      ],
    });

    expect(preserved.revisions).toHaveLength(1);

    await expect(
      courses.join(outsider, String(before.course.inviteCode))
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      courses.submit(student, course.id, assignment.id, {
        requestId: randomUUID(),
        version: 1,
        answers: [{ id: '1', answer: '새 제출' }],
      })
    ).rejects.toMatchObject({ status: 404 });
  });
});
