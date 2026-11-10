import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 기존 개인 학습 기록과 분리해 추천 선택·수업 제출·명시적 커뮤니티 공개를 저장한다. */
export class LearningExtensions1800000001000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE "RecommendationFeedback" (
      "userId" text REFERENCES "User"(id) ON DELETE CASCADE, "videoId" text REFERENCES "Video"(id) ON DELETE CASCADE,
      interested boolean NOT NULL, "updatedAt" timestamp(3) NOT NULL DEFAULT now(), PRIMARY KEY("userId", "videoId"))`);

    await runner.query(`CREATE TABLE "Course" (
      id text PRIMARY KEY DEFAULT gen_random_uuid(), "ownerId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      title text NOT NULL, language text NOT NULL CHECK(language IN ('en','th')), "inviteCode" text UNIQUE NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamp(3) NOT NULL DEFAULT now())`);

    await runner.query(`CREATE TABLE "CourseMember" (
      "courseId" text REFERENCES "Course"(id) ON DELETE CASCADE, "userId" text REFERENCES "User"(id) ON DELETE CASCADE,
      role text NOT NULL CHECK(role IN ('teacher','assistant','student')), "createdAt" timestamp(3) NOT NULL DEFAULT now(), PRIMARY KEY("courseId", "userId"))`);

    await runner.query(`CREATE TABLE "CourseAssignment" (
      id text PRIMARY KEY DEFAULT gen_random_uuid(), "courseId" text NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
      version integer NOT NULL DEFAULT 1, title text NOT NULL, source jsonb NOT NULL, mode text NOT NULL CHECK(mode IN ('full','blank')),
      "dueAt" timestamp(3) NOT NULL, "allowLate" boolean NOT NULL, "allowResubmit" boolean NOT NULL,
      "allowHints" boolean NOT NULL, "revealAfterSubmit" boolean NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT now(),
      "updatedAt" timestamp(3) NOT NULL DEFAULT now())`);

    await runner.query(`CREATE TABLE "CourseAssignmentRevision" (
      "assignmentId" text REFERENCES "CourseAssignment"(id) ON DELETE CASCADE, version integer NOT NULL,
      payload jsonb NOT NULL, reason text NOT NULL, "actorId" text REFERENCES "User"(id) ON DELETE SET NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT now(), PRIMARY KEY("assignmentId", version))`);

    await runner.query(`CREATE TABLE "CourseSubmission" (
      id text PRIMARY KEY, "assignmentId" text NOT NULL REFERENCES "CourseAssignment"(id) ON DELETE CASCADE,
      "userId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE, version integer NOT NULL,
      answers jsonb NOT NULL, result jsonb NOT NULL, "assignmentSnapshot" jsonb NOT NULL,
      late boolean NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT now())`);

    await runner.query(
      `CREATE INDEX ON "CourseSubmission"("assignmentId", "userId", "createdAt")`
    );

    await runner.query(`CREATE TABLE "CourseHint" (
      "assignmentId" text REFERENCES "CourseAssignment"(id) ON DELETE CASCADE, "userId" text REFERENCES "User"(id) ON DELETE CASCADE,
      version integer NOT NULL, "taskId" text NOT NULL, count integer NOT NULL DEFAULT 0,
      PRIMARY KEY("assignmentId", "userId", version, "taskId"))`);

    await runner.query(`CREATE TABLE "CommunityPost" (
      id text PRIMARY KEY DEFAULT gen_random_uuid(), "ownerId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      title text NOT NULL, body text NOT NULL, language text NOT NULL CHECK(language IN ('en','th')), source jsonb,
      visibility text NOT NULL CHECK(visibility IN ('public','accounts')), "allowedUserIds" jsonb NOT NULL DEFAULT '[]',
      "createdAt" timestamp(3) NOT NULL DEFAULT now(), "updatedAt" timestamp(3) NOT NULL DEFAULT now())`);

    await runner.query(`CREATE TABLE "CommunityComment" (
      id text PRIMARY KEY DEFAULT gen_random_uuid(), "postId" text NOT NULL REFERENCES "CommunityPost"(id) ON DELETE CASCADE,
      "ownerId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE, body text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT now())`);

    await runner.query(`CREATE TABLE "CommunityReaction" (
      "postId" text REFERENCES "CommunityPost"(id) ON DELETE CASCADE, "userId" text REFERENCES "User"(id) ON DELETE CASCADE,
      "createdAt" timestamp(3) NOT NULL DEFAULT now(), PRIMARY KEY("postId", "userId"))`);

    await runner.query(`CREATE TABLE "CommunityFollow" (
      "followerId" text REFERENCES "User"(id) ON DELETE CASCADE, "followingId" text REFERENCES "User"(id) ON DELETE CASCADE,
      "createdAt" timestamp(3) NOT NULL DEFAULT now(), PRIMARY KEY("followerId", "followingId"))`);
  }
  async down(): Promise<void> {
    throw new Error(
      '수업 제출과 공개 이력을 보호하기 위해 후속 마이그레이션을 사용해 주세요.'
    );
  }
}
