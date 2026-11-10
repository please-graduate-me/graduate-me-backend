import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { z } from 'zod';
import { HttpError } from '../common/http-error.js';
import { User } from '../database/entities/User.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { Job } from '../database/entities/Job.entity.js';
import { requireReadableVideo } from '../videos/access.js';
import { readableMaterial } from '../learning/access.js';
import { blankIndices, learningUnits } from '../videos/grading.js';
import type {
  assignmentInputSchema,
  assignmentSubmitSchema,
  assignmentUpdateSchema,
  courseInputSchema,
  courseMemberSchema,
} from './contracts.js';

type Task = {
  id: string;
  text: string;
  version: number;
  start?: number;
  end?: number;
  page?: number;
  blanks: number[];
  units: string[];
};
type Assignment = {
  id: string;
  courseId: string;
  version: number;
  title: string;
  source: {
    kind: 'video' | 'pdf';
    youtubeId?: string;
    fromIndex: number;
    toIndex: number;
    blankRatio: 20 | 40 | 60;
    id: string;
    title: string;
    language: 'en' | 'th';
    version: number;
    tasks: Task[];
  };
  mode: 'full' | 'blank' | 'reading';
  dueAt: Date;
  allowLate: boolean;
  allowResubmit: boolean;
  allowHints: boolean;
  revealAfterSubmit: boolean;
  createdAt: Date;
  updatedAt: Date;
};
type Membership = { role: 'teacher' | 'assistant' | 'student' };

/** 수업 소속·원본 권한·과제 제출을 개인 학습 기록과 별도로 검증한다. */
@Injectable()
export class CoursesService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  private async membership(
    userId: string,
    courseId: string,
    staff = false,
    tx = this.db.manager
  ) {
    // 수업 역할만 확인하며 전역 도우미·운영 권한을 수업 개설로 부여하지 않는다.
    const rows: Membership[] = await tx.query(
      'SELECT role FROM "CourseMember" WHERE "courseId"=$1 AND "userId"=$2',
      [courseId, userId]
    );

    if (!rows[0] || (staff && rows[0].role === 'student'))
      throw new HttpError(404, '접근할 수 있는 수업을 찾을 수 없습니다.');

    return rows[0];
  }
  async list(userId: string) {
    const items: Record<string, unknown>[] = await this.db.query(
      `SELECT c.id,c.title,c.language,c."createdAt",m.role,(c."ownerId" IS NULL) AS "ownerUnavailable" FROM "Course" c JOIN "CourseMember" m ON m."courseId"=c.id WHERE m."userId"=$1 ORDER BY c."createdAt" DESC`,
      [userId]
    );

    return { items };
  }
  async create(userId: string, input: z.infer<typeof courseInputSchema>) {
    return this.db.transaction(async (tx) => {
      const rows: { id: string }[] = await tx.query(
        `INSERT INTO "Course"("ownerId",title,language) VALUES($1,$2,$3) RETURNING id`,
        [userId, input.title, input.language]
      );

      await tx.query(
        `INSERT INTO "CourseMember"("courseId","userId",role) VALUES($1,$2,'teacher')`,
        [rows[0].id, userId]
      );

      return { id: rows[0].id };
    });
  }
  async join(userId: string, inviteCode: string) {
    const rows: { id: string }[] = await this.db.query(
      'SELECT id FROM "Course" WHERE "inviteCode"=$1 AND "ownerId" IS NOT NULL',
      [inviteCode]
    );

    if (!rows[0]) throw new HttpError(404, '수업 초대 코드를 확인해 주세요.');

    await this.db.query(
      `INSERT INTO "CourseMember"("courseId","userId",role) VALUES($1,$2,'student') ON CONFLICT DO NOTHING`,
      [rows[0].id, userId]
    );

    return { id: rows[0].id };
  }
  async detail(userId: string, id: string) {
    const access = await this.membership(userId, id);

    const courses: {
      id: string;
      title: string;
      language: 'en' | 'th';
      createdAt: Date;
      inviteCode?: string;
      ownerUnavailable: boolean;
    }[] = await this.db.query(
      `SELECT id,title,language,"createdAt",("ownerId" IS NULL) AS "ownerUnavailable"${access.role !== 'student' ? ',"inviteCode"' : ''} FROM "Course" WHERE id=$1`,
      [id]
    );

    const members: Record<string, unknown>[] = await this.db.query(
      `SELECT m."userId",m.role,u.name FROM "CourseMember" m JOIN "User" u ON u.id=m."userId" WHERE m."courseId"=$1 ${access.role === 'student' ? 'AND m."userId"=$2' : ''} ORDER BY m."createdAt"`,
      access.role === 'student' ? [id, userId] : [id]
    );

    const assignments: Assignment[] = await this.db.query(
      'SELECT * FROM "CourseAssignment" WHERE "courseId"=$1 ORDER BY "createdAt" DESC',
      [id]
    );

    const submissions: {
      assignmentId: string;
      version: number;
      createdAt: Date;
      late: boolean;
    }[] = await this.db.query(
      `SELECT "assignmentId",version,"createdAt",late FROM "CourseSubmission" WHERE "userId"=$1 AND "assignmentId" IN(SELECT id FROM "CourseAssignment" WHERE "courseId"=$2) ORDER BY "createdAt" DESC`,
      [userId, id]
    );

    return {
      course: { ...courses[0], role: access.role },
      members,
      assignments: assignments.map((a) => ({
        id: a.id,
        title: a.title,
        version: a.version,
        mode: a.mode,
        dueAt: a.dueAt,
        allowLate: a.allowLate,
        allowResubmit: a.allowResubmit,
        source: { kind: a.source.kind, id: a.source.id, title: a.source.title },
        taskCount: a.source.tasks.length,
        submission: submissions.find((s) => s.assignmentId === a.id) ?? null,
      })),
    };
  }
  async member(
    userId: string,
    courseId: string,
    input: z.infer<typeof courseMemberSchema>
  ) {
    const role = await this.membership(userId, courseId, true);

    if (role.role !== 'teacher')
      throw new HttpError(403, '수업 개설자만 구성원을 관리할 수 있습니다.');
    if (userId === input.userId)
      throw new HttpError(400, '수업 개설자의 역할은 변경할 수 없습니다.');
    if (!(await this.db.manager.existsBy(User, { id: input.userId })))
      throw new HttpError(404, '가입한 계정을 확인해 주세요.');

    await this.db.query(
      `INSERT INTO "CourseMember"("courseId","userId",role) VALUES($1,$2,$3) ON CONFLICT("courseId","userId") DO UPDATE SET role=$3`,
      [courseId, input.userId, input.role]
    );

    return { ok: true };
  }
  async removeMember(userId: string, courseId: string, targetId: string) {
    const access = await this.membership(userId, courseId);

    if (userId !== targetId && access.role !== 'teacher')
      throw new HttpError(
        403,
        '수업 개설자만 다른 구성원을 제외할 수 있습니다.'
      );

    const rows: { ownerId: string | null }[] = await this.db.query(
      'SELECT "ownerId" FROM "Course" WHERE id=$1',
      [courseId]
    );

    if (rows[0].ownerId === targetId)
      throw new HttpError(409, '수업 개설자는 구성원에서 제외할 수 없습니다.');

    await this.db.query(
      'DELETE FROM "CourseMember" WHERE "courseId"=$1 AND "userId"=$2',
      [courseId, targetId]
    );

    return { ok: true };
  }
  private async snapshot(
    userId: string,
    input: z.infer<typeof assignmentInputSchema>
  ) {
    if (input.videoId) {
      const video = await requireReadableVideo(this.db, userId, input.videoId);
      const job = await this.db.manager.findOneBy(Job, { videoId: video.id });

      if (
        job?.status !== 'ready' ||
        (input.mode === 'blank' && video.blankStatus !== 'ready')
      )
        throw new HttpError(409, '과제 학습 자료가 준비되지 않았습니다.');

      const segments = await this.db.manager.find(Segment, {
        where: { videoId: video.id },
        order: { index: 'ASC' },
      });

      if (input.toIndex >= segments.length)
        throw new HttpError(400, '영상 구절 범위를 확인해 주세요.');

      if (
        input.mode === 'blank' &&
        segments
          .slice(input.fromIndex, input.toIndex + 1)
          .some(
            (segment) =>
              blankIndices(
                segment.text,
                input.blankRatio,
                segment.blankCandidates,
                video.language
              ).length === 0
          )
      )
        throw new HttpError(
          400,
          '빈칸을 만들 수 없는 구절이 포함되어 있습니다. 구절 범위 또는 전체 받아쓰기 모드를 선택해 주세요.'
        );

      return {
        kind: 'video' as const,
        id: video.id,
        youtubeId: video.youtubeId,
        fromIndex: input.fromIndex,
        toIndex: input.toIndex,
        blankRatio: input.blankRatio,
        title: video.title,
        language: video.language,
        version: video.version,
        tasks: segments.slice(input.fromIndex, input.toIndex + 1).map((s) => ({
          id: s.id,
          text: s.text,
          version: s.version,
          start: s.start,
          end: s.end,
          units: learningUnits(s.text, video.language),
          blanks: blankIndices(
            s.text,
            input.blankRatio,
            s.blankCandidates,
            video.language
          ),
        })),
      };
    }

    const material = await readableMaterial(this.db, userId, input.materialId!);

    if (input.toIndex >= material.pages.length)
      throw new HttpError(400, 'PDF 페이지 범위를 확인해 주세요.');

    return {
      kind: 'pdf' as const,
      id: material.id,
      fromIndex: input.fromIndex,
      toIndex: input.toIndex,
      blankRatio: input.blankRatio,
      title: material.title,
      language: material.language,
      version: material.version,
      tasks: material.pages
        .slice(input.fromIndex, input.toIndex + 1)
        .map((text, i) => ({
          id: String(input.fromIndex + i + 1),
          text,
          version: material.version,
          page: input.fromIndex + i + 1,
          units: [],
          blanks: [],
        })),
    };
  }
  async assign(
    userId: string,
    courseId: string,
    input: z.infer<typeof assignmentInputSchema>,
    assignmentId?: string,
    update?: z.infer<typeof assignmentUpdateSchema>
  ) {
    await this.membership(userId, courseId, true);
    const source = await this.snapshot(userId, input);

    const courses: { language: string }[] = await this.db.query(
      'SELECT language FROM "Course" WHERE id=$1',
      [courseId]
    );

    if (source.language !== courses[0].language)
      throw new HttpError(400, '수업과 자료의 언어가 다릅니다.');

    return this.db.transaction(async (tx) => {
      await this.membership(userId, courseId, true, tx);

      const params = [
        input.title,
        JSON.stringify(source),
        input.mode,
        new Date(input.dueAt),
        input.allowLate,
        input.allowResubmit,
        input.allowHints,
        input.revealAfterSubmit,
      ];

      let rows: Assignment[];

      if (assignmentId && update) {
        rows = await tx.query(
          `WITH changed AS (UPDATE "CourseAssignment" SET title=$1,source=$2,mode=$3,"dueAt"=$4,"allowLate"=$5,"allowResubmit"=$6,"allowHints"=$7,"revealAfterSubmit"=$8,version=version+1,"updatedAt"=now() WHERE id=$9 AND "courseId"=$10 AND version=$11 RETURNING *) SELECT * FROM changed`,
          [...params, assignmentId, courseId, update.expectedVersion]
        );

        if (!rows[0])
          throw new HttpError(
            409,
            '과제가 변경되었습니다. 최신 버전을 확인해 주세요.'
          );
      } else {
        rows = await tx.query(
          `INSERT INTO "CourseAssignment"(title,source,mode,"dueAt","allowLate","allowResubmit","allowHints","revealAfterSubmit","courseId") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [...params, courseId]
        );
      }

      await tx.query(
        `INSERT INTO "CourseAssignmentRevision"("assignmentId",version,payload,reason,"actorId") VALUES($1,$2,$3,$4,$5)`,
        [
          rows[0].id,
          rows[0].version,
          JSON.stringify(rows[0]),
          update?.reason ?? '최초 배정',
          userId,
        ]
      );

      return { id: rows[0].id, version: rows[0].version };
    });
  }
  private async assignment(
    userId: string,
    courseId: string,
    id: string,
    tx = this.db.manager
  ) {
    const access = await this.membership(userId, courseId, false, tx);

    const rows: Assignment[] = await tx.query(
      'SELECT * FROM "CourseAssignment" WHERE id=$1 AND "courseId"=$2',
      [id, courseId]
    );

    if (!rows[0]) throw new HttpError(404, '과제를 찾을 수 없습니다.');

    return { access, row: rows[0] };
  }
  private async originalAccess(userId: string, row: Assignment) {
    if (row.source.kind === 'video')
      await requireReadableVideo(this.db, userId, row.source.id);
    else await readableMaterial(this.db, userId, row.source.id);
  }
  async getAssignment(userId: string, courseId: string, id: string) {
    const { access, row } = await this.assignment(userId, courseId, id);

    // 원본 철회·삭제는 새 학습만 막고 이미 제출한 본인의 답안 기록을 삭제하거나 숨기지 않는다.
    let sourceAvailable = true;

    try {
      await this.originalAccess(userId, row);
    } catch (error) {
      if (error instanceof HttpError && [403, 404].includes(error.getStatus()))
        sourceAvailable = false;
      else throw error;
    }

    const staff = access.role !== 'student';

    const submissions: Record<string, unknown>[] = await this.db.query(
      `SELECT s.*,u.name AS "studentName" FROM "CourseSubmission" s JOIN "User" u ON u.id=s."userId" WHERE s."assignmentId"=$1 ${staff ? '' : 'AND s."userId"=$2'} ORDER BY s."createdAt" DESC`,
      staff ? [id] : [id, userId]
    );

    // 담당자 조회와 학생 제출 후 공개 정책을 구분해 과제 응답에 정답이 먼저 섞이지 않게 한다.
    const reveal =
      staff ||
      (row.revealAfterSubmit &&
        submissions.some((s) => s.version === row.version));

    const revisions: Record<string, unknown>[] = await this.db.query(
      `SELECT version,reason,"createdAt"${staff ? ',"actorId"' : ''} FROM "CourseAssignmentRevision" WHERE "assignmentId"=$1 ORDER BY version DESC`,
      [id]
    );

    return {
      ...row,
      sourceAvailable,
      source: {
        ...row.source,
        tasks: sourceAvailable
          ? row.source.tasks.map((task) => ({
              ...task,
              text: reveal || row.mode === 'reading' ? task.text : null,
              units:
                row.mode === 'blank'
                  ? task.units.map((u, i) =>
                      reveal || !task.blanks.includes(i) ? u : null
                    )
                  : [],
            }))
          : [],
      },
      submissions: submissions.map((s) =>
        this.submissionDto(s, staff, sourceAvailable)
      ),
      revisions,
    };
  }
  private submissionDto(
    row: Record<string, unknown>,
    staff: boolean,
    sourceAvailable = true
  ) {
    const snapshot = row.assignmentSnapshot as Assignment;

    if ((staff && sourceAvailable) || (!staff && snapshot.revealAfterSubmit))
      return row;

    // 제출 정책이 정답을 숨기면 당시 스냅샷과 정답을 함께 노출하지 않는다.
    return {
      ...row,
      assignmentSnapshot: {
        id: snapshot.id,
        title: snapshot.title,
        version: snapshot.version,
      },
      result: (row.result as Record<string, unknown>[]).map((r) => ({
        ...r,
        expected: undefined,
      })),
    };
  }
  async hint(
    userId: string,
    courseId: string,
    id: string,
    version: number,
    taskId: string
  ) {
    const { access, row } = await this.assignment(userId, courseId, id);

    await this.originalAccess(userId, row);
    if (access.role !== 'student' || !row.allowHints)
      throw new HttpError(403, '이 과제에서는 힌트를 사용할 수 없습니다.');
    if (row.version !== version)
      throw new HttpError(409, '최신 과제 버전을 확인해 주세요.');
    const task = row.source.tasks.find((task) => task.id === taskId);

    if (!task || row.mode === 'reading')
      throw new HttpError(400, '힌트를 사용할 구절을 확인해 주세요.');

    const rows: { count: number }[] = await this.db.query(
      `INSERT INTO "CourseHint"("assignmentId","userId",version,"taskId",count) VALUES($1,$2,$3,$4,1) ON CONFLICT("assignmentId","userId",version,"taskId") DO UPDATE SET count="CourseHint".count+1 RETURNING count`,
      [id, userId, version, taskId]
    );

    const units =
      row.mode === 'blank'
        ? task.blanks.map((i) => task.units[i])
        : task.units.filter((u) => /[\p{L}\p{N}]/u.test(u));

    return {
      hint: units
        .slice(0, Math.min(rows[0].count, units.length))
        .join(row.source.language === 'th' ? '' : ' '),
      hintCount: rows[0].count,
    };
  }
  async submit(
    userId: string,
    courseId: string,
    id: string,
    input: z.infer<typeof assignmentSubmitSchema>
  ) {
    const { access, row } = await this.assignment(userId, courseId, id);

    if (access.role !== 'student')
      throw new HttpError(403, '수강생 계정만 과제를 제출할 수 있습니다.');
    await this.originalAccess(userId, row);

    return this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `course-submit:${id}:${userId}`,
      ]);

      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `course-request:${input.requestId}`,
      ]);

      const existing: Record<string, unknown>[] = await tx.query(
        'SELECT * FROM "CourseSubmission" WHERE id=$1',
        [input.requestId]
      );

      if (existing[0]) {
        if (
          existing[0].userId !== userId ||
          existing[0].assignmentId !== id ||
          existing[0].version !== input.version ||
          (existing[0].answers as typeof input.answers).length !==
            input.answers.length ||
          new Set(input.answers.map((answer) => answer.id)).size !==
            input.answers.length ||
          !input.answers.every((answer) =>
            (existing[0].answers as typeof input.answers).some(
              (saved) =>
                saved.id === answer.id &&
                JSON.stringify(saved.answer) === JSON.stringify(answer.answer)
            )
          )
        )
          throw new HttpError(409, '이미 사용한 과제 제출 식별자입니다.');

        return this.submissionDto(existing[0], false);
      }

      // 제출 중 과제 수정이 끼어들어 채점 스냅샷과 저장 버전이 달라지지 않게 한다.
      await tx.query(
        'SELECT id FROM "CourseAssignment" WHERE id=$1 FOR SHARE',
        [id]
      );

      const current = await this.assignment(userId, courseId, id, tx);
      const row = current.row;

      if (current.access.role !== 'student')
        throw new HttpError(403, '수강생 계정만 과제를 제출할 수 있습니다.');

      if (current.row.version !== input.version)
        throw new HttpError(
          409,
          '과제가 변경되었습니다. 최신 버전을 확인해 주세요.'
        );
      // 기한은 최종 제출 시점에 판단하고 재전송은 기존 제출의 기한 판정을 그대로 보존한다.
      const late = Date.now() > row.dueAt.getTime();

      if (late && !row.allowLate)
        throw new HttpError(409, '제출 기한이 지났습니다.');

      const previous: { id: string }[] = await tx.query(
        'SELECT id FROM "CourseSubmission" WHERE "assignmentId"=$1 AND "userId"=$2 AND version=$3',
        [id, userId, row.version]
      );

      if (previous.length && !row.allowResubmit)
        throw new HttpError(409, '이 과제는 재제출할 수 없습니다.');
      if (
        input.answers.length !== row.source.tasks.length ||
        new Set(input.answers.map((a) => a.id)).size !== input.answers.length
      )
        throw new HttpError(400, '모든 과제 항목에 한 번씩 답해 주세요.');

      const hints: { taskId: string; count: number }[] = await tx.query(
        'SELECT "taskId",count FROM "CourseHint" WHERE "assignmentId"=$1 AND "userId"=$2 AND version=$3',
        [id, userId, row.version]
      );

      const result = row.source.tasks.map((task) => {
        const answer = input.answers.find((a) => a.id === task.id)?.answer;

        if (answer === undefined)
          throw new HttpError(400, '과제 항목을 확인해 주세요.');

        if (row.mode === 'reading') {
          if (typeof answer !== 'string' || !answer.trim())
            throw new HttpError(400, '읽기 응답을 입력해 주세요.');

          return { id: task.id, correct: null, expected: null };
        }

        if (
          row.mode === 'full'
            ? typeof answer !== 'string'
            : !Array.isArray(answer) || answer.length !== task.blanks.length
        )
          throw new HttpError(400, '과제 모드에 맞는 답안을 입력해 주세요.');

        const correct =
          row.mode === 'full'
            ? (answer as string).trim() === task.text.trim()
            : (answer as string[]).length > 0 &&
              (answer as string[]).every(
                (value, i) => value.trim() === task.units[task.blanks[i]].trim()
              );

        return {
          id: task.id,
          correct,
          hintCount: hints.find((h) => h.taskId === task.id)?.count ?? 0,
          expected:
            row.mode === 'full'
              ? task.text
              : task.blanks.map((i) => task.units[i]),
        };
      });

      const saved: Record<string, unknown>[] = await tx.query(
        `INSERT INTO "CourseSubmission"(id,"assignmentId","userId",version,answers,result,"assignmentSnapshot",late) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          input.requestId,
          id,
          userId,
          row.version,
          JSON.stringify(input.answers),
          JSON.stringify(result),
          JSON.stringify(row),
          late,
        ]
      );

      return this.submissionDto(saved[0], false);
    });
  }
}
