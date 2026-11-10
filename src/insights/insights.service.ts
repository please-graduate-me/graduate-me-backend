import { PersonalizationService } from './personalization.service.js';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../database/entities/User.entity.js';
import { HttpError } from '../common/http-error.js';
import { requireReadableVideo } from '../videos/access.js';

type Evidence = {
  id: string;
  videoId: string;
  segmentId: string;
  title: string;
  answer: string | string[];
  sourceText: string;
  sourceVersion: number;
  correct: boolean;
  createdAt: Date;
  revealed: boolean;
  hintCount: number;
};

function errorCategory(row: Evidence, language: string) {
  const answer = (
    Array.isArray(row.answer) ? row.answer.join(' ') : row.answer
  ).trim();

  const expected = row.sourceText.trim();

  if (!answer) return '미입력';
  if (Array.isArray(row.answer)) return '빈칸 답안 차이';
  if (answer.replace(/\s/g, '') === expected.replace(/\s/g, ''))
    return '공백 차이';
  if (language === 'en' && answer.toLowerCase() === expected.toLowerCase())
    return '대소문자 차이';
  if (answer.replace(/\p{P}/gu, '') === expected.replace(/\p{P}/gu, ''))
    return '문장부호 차이';
  if (
    language === 'th' &&
    answer.replace(/[่้๊๋]/g, '') === expected.replace(/[่้๊๋]/g, '')
  )
    return '성조 표기 차이';

  return expected.length > 100 ? '긴 구절의 차이' : '원문과 답안 차이';
}

/** 실제 제출 근거만 집계하며 검증되지 않은 능력 진단이나 AI 요약으로 표시하지 않는다. */
@Injectable()
export class InsightsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(PersonalizationService)
    private readonly personalization?: PersonalizationService
  ) {}
  async report(userId: string, language: 'en' | 'th', days: number) {
    const since = new Date(Date.now() - days * 86400000);

    const rows: Evidence[] = await this.db.query(
      `SELECT a.id, p."videoId", a."segmentId", v.title, a.answer,
      COALESCE(a.result->>'sourceText', s.text) AS "sourceText", COALESCE((a.result->>'sourceVersion')::int,1) AS "sourceVersion",
      a.correct, a."createdAt", COALESCE((a.result->>'revealed')::boolean,false) AS revealed,
      COALESCE((a.result->>'hintCount')::int,0) AS "hintCount"
      FROM "Attempt" a JOIN "Progress" p ON p.id=a."progressId" JOIN "Video" v ON v.id=p."videoId"
      JOIN "Segment" s ON s.id=a."segmentId" WHERE p."userId"=$1 AND v.language=$2 AND a."createdAt">=$3
      AND NOT EXISTS (SELECT 1 FROM "ReviewRequest" r WHERE r.status='open' AND r.target->>'id'=s.id)
      ORDER BY a."createdAt" DESC LIMIT 2000`,
      [userId, language, since]
    );

    // 정답을 본 뒤의 성공과 힌트 사용을 독립 수행의 약점·정답률 근거로 섞지 않는다.
    const unassisted = rows.filter((r) => !r.revealed && r.hintCount === 0);
    const wrong = unassisted.filter((r) => !r.correct);
    const categories = new Map<string, number>();

    for (const row of wrong) {
      const category = errorCategory(row, language);

      categories.set(category, (categories.get(category) ?? 0) + 1);
    }

    const grouped = new Map<
      string,
      { evidence: Evidence; mistakes: number; attempts: number }
    >();

    for (const row of unassisted) {
      const key = `${row.segmentId}:${row.sourceVersion}`;

      const group = grouped.get(key) ?? {
        evidence: row,
        mistakes: 0,
        attempts: 0,
      };

      group.attempts++;

      if (!row.correct) {
        group.mistakes++;
        if (group.evidence.correct) group.evidence = row;
      }

      grouped.set(key, group);
    }

    const review = [...grouped.values()]
      .filter((g) => g.mistakes > 0)
      .sort((a, b) => b.mistakes - a.mistakes)
      .slice(0, 20)
      .map((g) => ({
        ...g,
        category: errorCategory(g.evidence, language),
        href: `/learn/${encodeURIComponent(g.evidence.videoId)}?${new URLSearchParams({ segment: g.evidence.segmentId, version: String(g.evidence.sourceVersion) })}`,
      }));

    const daysStudied = new Set(
      rows.map((r) => r.createdAt.toISOString().slice(0, 10))
    ).size;

    return {
      language,
      days,
      since,
      classificationVersion: 'observed-text-v1',
      sampleSize: rows.length,
      unassistedSamples: unassisted.length,
      excludedAssisted: rows.length - unassisted.length,
      insufficientData: unassisted.length < 5,
      correct: unassisted.filter((r) => r.correct).length,
      accuracy: unassisted.length
        ? Math.round(
            (unassisted.filter((r) => r.correct).length / unassisted.length) *
              100
          )
        : null,
      daysStudied,
      categories: [...categories].map(([category, count]) => ({
        category,
        count,
      })),
      review,
      basis:
        '선택 기간의 최근 최대 2,000개 실제 답안. 힌트·정답 열람과 검토 중 구절 제외. 원인 진단이 아닌 문자열 차이 분류입니다.',
      roadmap: [
        {
          year: 1,
          title: '원문 학습 습관',
          goal: 'PDF와 영상에서 표현을 저장하고 매주 복습하기',
        },
        {
          year: 2,
          title: '문맥 이해와 적용',
          goal: '원문 설명과 짧은 적용 문제로 이해 확인하기',
        },
        {
          year: 3,
          title: '전공 표현 확장',
          goal: '반복 오답을 복습하고 FLEX형 연습 수행하기',
        },
        {
          year: 4,
          title: '목표 점검',
          goal: '학과 공식 졸업 요건을 별도 확인하고 학습 기록 점검하기',
        },
      ],
      roadmapBasis:
        '서비스의 일반 권장 학습 순서입니다. 학교·학과의 공식 졸업 요건이나 능력 인증이 아닙니다.',
    };
  }
  async recommendations(userId: string, language: 'en' | 'th') {
    const base = await this.recommendationCandidates(userId, language);

    const stored = await this.personalization?.latest(
      userId,
      language,
      base.items
    );

    const recommendations = stored?.analysis.recommendations ?? [];

    const priority = new Map(
      recommendations.map((r, index) => [r.videoId, index])
    );

    const items = base.items
      .map((item) => ({
        ...item,
        sampleText: undefined,
        reason:
          recommendations.find((r) => r.videoId === item.id)?.reason ??
          item.reason,
      }))
      .sort((a, b) => (priority.get(a.id) ?? 100) - (priority.get(b.id) ?? 100))
      .slice(0, 12);

    return {
      ...base,
      items,
      personalization: stored
        ? {
            summary: stored.analysis.summary.text,
            focusAreas: stored.analysis.focusAreas.map((f) => f.text),
            generatedAt: stored.generatedAt,
            evidenceCount: stored.evidenceCount,
            provider: stored.provider,
            model: stored.model,
          }
        : null,
      basis: stored
        ? '최근 30일의 학습 기록과 준비 영상 발췌에 근거한 AI 추천입니다. 능력 진단이나 시험 수준 인증이 아닙니다.'
        : base.basis,
    };
  }
  async personalize(userId: string, language: 'en' | 'th', requestId: string) {
    if (!this.personalization)
      throw new HttpError(503, '개인화 설정이 필요합니다.');
    const base = await this.recommendationCandidates(userId, language);

    await this.personalization.generate(
      userId,
      language,
      requestId,
      base.items
    );

    return this.recommendations(userId, language);
  }
  private async recommendationCandidates(
    userId: string,
    language: 'en' | 'th'
  ) {
    const user = await this.db.manager.findOneBy(User, { id: userId });

    if (!user) throw new HttpError(401, '로그인이 필요합니다.');

    const rows: {
      id: string;
      youtubeId: string;
      title: string;
      duration: number | null;
      category: string | null;
      averageLength: number | null;
      sampleText: string;
      completed: boolean;
    }[] = await this.db.query(
      `SELECT v.id,v."youtubeId",v.title,v.duration,v.category,
      COALESCE((SELECT string_agg(snippet.text, E'\\n' ORDER BY snippet.index) FROM (SELECT left(s.text,300) AS text,s.index FROM "Segment" s WHERE s."videoId"=v.id ORDER BY s.index LIMIT 3) snippet),'') AS "sampleText",
      (SELECT avg(length(s.text)) FROM "Segment" s WHERE s."videoId"=v.id) AS "averageLength",
      COALESCE((SELECT count(DISTINCT st."segmentId") FROM "SegmentState" st JOIN "Progress" p ON p.id=st."progressId" JOIN "Segment" s ON s.id=st."segmentId" WHERE p."userId"=$1 AND p."videoId"=v.id AND st.status='correct' AND st."sourceVersion"=s.version),0) >= (SELECT count(*) FROM "Segment" s WHERE s."videoId"=v.id) AS completed
      FROM "Video" v JOIN "Job" j ON j."videoId"=v.id AND j.status='ready' WHERE v.language=$2
      AND (v."ownerId"=$1 OR v.visibility='public' OR (v.visibility='accounts' AND v."allowedUserIds" ? $1))
      AND EXISTS(SELECT 1 FROM "Segment" s WHERE s."videoId"=v.id)
      AND NOT EXISTS(SELECT 1 FROM "RecommendationFeedback" f WHERE f."userId"=$1 AND f."videoId"=v.id AND NOT f.interested)
      ORDER BY v."createdAt" DESC LIMIT 100`,
      [userId, language]
    );

    const expressions: { text: string }[] = await this.db.query(
      `SELECT text FROM "Expression" WHERE "ownerId"=$1 AND source->>'language'=$2 LIMIT 100`,
      [userId, language]
    );

    // 선정에 사용한 관심·길이·완료 근거만 이유로 표시하고 미측정 발화 난이도를 단정하지 않는다.
    const items = rows
      .map((row) => {
        const matchedInterest = user.interests.find((interest) =>
          `${row.title} ${row.category ?? ''}`
            .toLowerCase()
            .includes(interest.toLowerCase())
        );

        const reason = matchedInterest
          ? `설정한 관심 주제 '${matchedInterest}'와 제목·분류가 일치합니다.`
          : '선택한 학습 언어의 준비된 자료입니다.';

        const averageLength =
          row.averageLength === null ? null : Number(row.averageLength);

        const levelMatch =
          averageLength !== null &&
          (user.level === 'beginner'
            ? averageLength <= 70
            : user.level === 'intermediate'
              ? averageLength <= 140
              : averageLength > 70);

        return {
          ...row,
          averageLength,
          language,
          reason,
          levelMatch,
          difficulty:
            averageLength === null
              ? '미분석'
              : averageLength <= 70
                ? '짧은 구절 중심'
                : averageLength <= 140
                  ? '보통 길이 구절'
                  : '긴 구절 중심',
          score:
            (matchedInterest ? 4 : 0) +
            (levelMatch ? 2 : 0) -
            (row.completed ? 10 : 0),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 24);

    return {
      language,
      items,
      insufficientCandidates: items.length === 0,
      basis:
        '접근 가능한 준비 영상의 언어·관심 주제·평균 구절 길이·실제 완료 기록을 사용한 규칙 추천입니다. 발화 난이도나 시험 수준의 검증 결과가 아닙니다.',
      savedExpressionCount: expressions.length,
    };
  }
  async event(
    userId: string,
    videoId: string,
    requestId: string,
    action: 'shown' | 'selected'
  ) {
    await requireReadableVideo(this.db, userId, videoId);

    return this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `recommendation-event:${requestId}`,
      ]);

      const rows: { userId: string; videoId: string; action: string }[] =
        await tx.query(
          'SELECT "userId","videoId",action FROM "RecommendationEvent" WHERE id=$1',
          [requestId]
        );

      if (
        rows[0] &&
        (rows[0].userId !== userId ||
          rows[0].videoId !== videoId ||
          rows[0].action !== action)
      )
        throw new HttpError(409, '이미 사용한 추천 이벤트 식별자입니다.');
      if (!rows[0])
        await tx.query(
          'INSERT INTO "RecommendationEvent"(id,"userId","videoId",action) VALUES($1,$2,$3,$4)',
          [requestId, userId, videoId, action]
        );

      return { ok: true };
    });
  }
  async feedback(userId: string, videoId: string, interested: boolean) {
    await requireReadableVideo(this.db, userId, videoId);

    await this.db.query(
      `INSERT INTO "RecommendationFeedback"("userId","videoId",interested) VALUES($1,$2,$3) ON CONFLICT("userId","videoId") DO UPDATE SET interested=$3,"updatedAt"=now()`,
      [userId, videoId, interested]
    );

    return { ok: true };
  }
}
