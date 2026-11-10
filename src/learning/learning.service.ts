import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PracticeAttempt } from '../database/entities/PracticeAttempt.entity.js';
import { ExerciseAttempt } from '../database/entities/ExerciseAttempt.entity.js';
import { Attempt } from '../database/entities/Attempt.entity.js';
import { Annotation } from '../database/entities/Annotation.entity.js';
import { LearningArtifact } from '../database/entities/LearningArtifact.entity.js';
import { AIConversation } from '../database/entities/AIConversation.entity.js';
import { MaterialReading } from '../database/entities/MaterialReading.entity.js';
import { MaterialsService } from './materials.service.js';
import { ExpressionsService } from './expressions.service.js';
import { QuestionsService } from './questions.service.js';
import type { LearningSource } from './contracts.js';

function sourcePath(source: LearningSource) {
  const query = new URLSearchParams({
    version: String(source.version ?? 1),
    quote: source.quote,
  });

  if (source.kind === 'pdf') {
    query.set('page', String(source.page));
    if (source.ocrId) query.set('ocrId', source.ocrId);

    return `/materials/${encodeURIComponent(source.materialId)}?${query}`;
  }

  query.set('segment', source.segmentId);

  return `/learn/${encodeURIComponent(source.videoId)}?${query}`;
}

/** 학생 홈과 학습 기록에 본인이 실제 수행한 활동만 합쳐 제공한다. */
@Injectable()
export class LearningService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(MaterialsService) private readonly materials: MaterialsService,
    @Inject(ExpressionsService)
    private readonly expressions: ExpressionsService,
    @Inject(QuestionsService) private readonly questions: QuestionsService
  ) {}
  private async personalMaterials(userId: string) {
    const [materials, readings] = await Promise.all([
      this.materials.list(userId),
      this.db.manager.findBy(MaterialReading, { ownerId: userId }),
    ]);

    const readIds = new Set(readings.map((r) => r.materialId));

    // 공개 자료 전체 목록을 개인의 읽기 이력이나 최근 학습으로 부풀리지 않는다.
    return materials.items.filter((m) => m.owned || readIds.has(m.id));
  }
  async summary(userId: string) {
    const [materials, expressions, questions] = await Promise.all([
      this.personalMaterials(userId),
      this.expressions.list(userId),
      this.questions.list(userId),
    ]);

    return {
      materials: materials.length,
      expressions: expressions.items.length,
      questions: questions.items.length,
      unanswered: questions.items.filter(
        (q) => q.status === 'waiting' && !q.resolvedAt && !q.revokedAt
      ).length,
      recentMaterials: materials.slice(0, 6),
      recentExpressions: expressions.items.slice(0, 6),
      recentQuestions: questions.items.slice(0, 6),
    };
  }
  async history(userId: string) {
    const [
      materials,
      questions,
      practice,
      exercises,
      videos,
      annotations,
      explanations,
      conversations,
      playback,
    ] = await Promise.all([
      this.personalMaterials(userId),
      this.questions.list(userId),
      this.db.manager.find(PracticeAttempt, {
        where: { ownerId: userId },
        order: { createdAt: 'DESC' },
        take: 100,
      }),
      this.db.manager.find(ExerciseAttempt, {
        where: { ownerId: userId },
        order: { createdAt: 'DESC' },
        take: 100,
      }),
      this.db
        .getRepository(Attempt)
        .createQueryBuilder('a')
        .innerJoinAndSelect('a.progress', 'p')
        .innerJoinAndSelect('p.video', 'v')
        .innerJoinAndSelect('a.segment', 's')
        .where('p.userId=:userId', { userId })
        .orderBy('a.createdAt', 'DESC')
        .take(100)
        .getMany(),
      this.db.manager.find(Annotation, {
        where: { ownerId: userId },
        order: { updatedAt: 'DESC' },
        take: 100,
      }),
      this.db.manager.find(LearningArtifact, {
        where: { ownerId: userId, kind: 'explanation' },
        order: { updatedAt: 'DESC' },
        take: 100,
      }),
      this.db.manager.find(AIConversation, {
        where: { ownerId: userId },
        order: { updatedAt: 'DESC' },
        take: 100,
      }),
      this.db.query<
        {
          id: string;
          videoId: string;
          title: string;
          language: 'en' | 'th';
          mode: string;
          position: number;
          maximum: number;
          updatedAt: Date;
          cycle: number;
          analysisVersion: string;
        }[]
      >(
        `SELECT w."progressId" || ':' || w."watchVersion" AS id,p."videoId",v.title,v.language,
        w."lastInput"->>'watchMode' AS mode,CASE WHEN w."lastInput"->>'watchMode'='script' THEN w."scriptPosition" ELSE w."playbackPosition" END AS position,
        w."scriptMaxPosition" AS maximum,w."updatedAt",w.cycle,w."analysisVersion" FROM "VideoPlayback" w
        JOIN "Progress" p ON p.id=w."progressId" JOIN "Video" v ON v.id=p."videoId" WHERE p."userId"=$1 ORDER BY w."updatedAt" DESC LIMIT 100`,
        [userId]
      ),
    ]);

    // 기록별 집계 단위를 보존해 PDF 읽기와 영상 정답·자가점검을 같은 완료량으로 섞지 않는다.
    const items = [
      ...materials.map((m) => ({
        id: `material:${m.id}`,
        kind: 'material',
        language: m.language,
        title: m.title,
        detail: `${m.currentPage} / ${m.pageCount}페이지`,
        createdAt: m.updatedAt,
        href: `/materials/${m.id}`,
      })),
      ...questions.items.map((q) => ({
        id: `question:${q.id}`,
        kind: 'question',
        language: q.source.language,
        title: q.title,
        detail: q.revokedAt
          ? '공유를 철회했습니다.'
          : q.resolvedAt
            ? '해결한 질문입니다.'
            : q.status === 'answered'
              ? '공개 답변이 도착했습니다.'
              : '답변을 기다리고 있습니다.',
        createdAt: q.updatedAt,
        href: `/questions/${q.id}`,
      })),
      ...practice.map((p) => ({
        id: p.id,
        kind: 'practice',
        language: p.snapshot.source.language,
        title: p.snapshot.text,
        detail: p.correct
          ? '자가점검 · 기억했어요'
          : '자가점검 · 다시 연습해요',
        createdAt: p.createdAt,
        href: '/practice',
      })),
      ...exercises.map((p) => ({
        id: `exercise:${p.id}`,
        kind: 'exercise',
        language: p.source.language,
        title: String(p.questionPayload.question ?? p.source.quote),
        detail: `문항 v${p.version} · ${p.correct === null ? '자유 답변 피드백' : p.correct ? '정답' : '다시 연습'}${p.hintUsed ? ' · 힌트 사용' : ''}${p.revealed ? ' · 정답 열람' : ''}`,
        createdAt: p.createdAt,
        href: `/practice?exerciseId=${encodeURIComponent(p.artifactId)}`,
      })),
      ...videos.map((p) => ({
        id: `video:${p.id}`,
        kind: 'video',
        language: p.progress.video.language,
        title: p.progress.video.title,
        detail: `${p.mode === 'full' ? '전체 받아쓰기' : '빈칸 받아쓰기'} · ${p.correct ? '정답' : '다시 연습'} · 구절 v${p.result.sourceVersion ?? 1}${p.result.revealed ? ' · 정답 열람' : ''}`,
        createdAt: p.createdAt,
        href: `/learn/${encodeURIComponent(p.progress.videoId)}?${new URLSearchParams({ segment: p.segmentId, version: String(p.result.sourceVersion ?? 1), quote: String(p.result.sourceText ?? p.segment.text) })}`,
      })),
      ...annotations.map((p) => ({
        id: `annotation:${p.id}`,
        kind: 'annotation',
        language: p.source.language,
        title: p.source.quote,
        detail: p.memo ? '위치 메모와 하이라이트 저장' : '원문 하이라이트 저장',
        createdAt: p.updatedAt,
        href: sourcePath(p.source),
      })),
      ...explanations.map((p) => ({
        id: `explanation:${p.id}`,
        kind: 'explanation',
        language: p.source.language,
        title: p.source.title,
        detail: `AI 설명 v${p.version}${p.needsReview ? ' · 확인 필요' : ''}`,
        createdAt: p.updatedAt,
        href: sourcePath(p.source),
      })),
      // 저장된 재생 시각은 정답률·완료량과 섞지 않고 독립적인 시청 활동으로 표시한다.
      ...playback.map((p) => ({
        id: `watch:${p.id}`,
        kind: 'watch',
        language: p.language,
        title: p.title,
        detail:
          p.mode === 'script'
            ? `스크립트 시청 위치 ${Math.floor(p.position)}초 · 최대 도달 ${Math.floor(p.maximum)}초 · 정답 진도와 별도`
            : `받아쓰기 재생 위치 ${Math.floor(p.position)}초`,
        createdAt: p.updatedAt,
        href: `/learn/${encodeURIComponent(p.videoId)}`,
      })),
      ...conversations.map((p) => ({
        id: `conversation:${p.id}`,
        kind: 'conversation',
        language: p.source.language,
        title: p.source.title,
        detail: '원문별 개인 AI 대화',
        createdAt: p.updatedAt,
        href: sourcePath(p.source),
      })),
    ];

    return {
      items: items
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 100),
    };
  }
}
