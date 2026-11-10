import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SourceService } from '../learning/source.service.js';
import {
  sourceInputSchema,
  type LearningSource,
} from '../learning/contracts.js';
import { HttpError } from '../common/http-error.js';
import { inputFingerprint } from './operation.service.js';

type HistoryRow = {
  id: string;
  kind: string;
  source: LearningSource;
  text: string;
};

/** 개인화 근거는 계정·언어·기간을 제한하고 현재 접근 가능한 원문만 사용한다. */
@Injectable()
export class LearningHistoryService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(SourceService) private readonly sources: SourceService
  ) {}

  async collect(ownerId: string, language: 'en' | 'th') {
    const since = new Date(Date.now() - 30 * 86400000);
    const parameters = [ownerId, language, since];

    const rows = await Promise.all([
      this.db.query<HistoryRow[]>(
        `SELECT 'dictation:' || a.id AS id, 'dictation_mistake' AS kind,
        jsonb_build_object('kind','video','videoId',p."videoId",'segmentId',s.id,'quote',s.text,'version',s.version) AS source,
        left(a.answer::text,1000) AS text
        FROM "Attempt" a JOIN "Progress" p ON p.id=a."progressId" JOIN "Segment" s ON s.id=a."segmentId"
        JOIN "Video" v ON v.id=p."videoId"
        WHERE p."userId"=$1 AND v.language=$2 AND a."createdAt">=$3 AND p."archivedAt" IS NULL
        AND a.correct=false AND COALESCE((a.result->>'revealed')::boolean,true)=false
        AND COALESCE((a.result->>'hintCount')::int,1)=0
        AND (a.result->>'sourceVersion')::int=s.version
        AND NOT EXISTS(SELECT 1 FROM "ReviewRequest" r WHERE r.status='open' AND r.target->>'id'=s.id)
        AND NOT EXISTS(SELECT 1 FROM "SourceRevision" r WHERE r."segmentId"=s.id AND r.version=s.version AND r."reviewStatus"='needs_review')
        ORDER BY a."createdAt" DESC,a.id LIMIT 10`,
        parameters
      ),
      this.db.query<HistoryRow[]>(
        `SELECT 'exercise:' || p.id AS id, 'exercise_mistake' AS kind,p.source,
        left(jsonb_build_object('question',p."questionPayload"->>'question','answer',p.answer,'expected',p."expectedAnswer")::text,1500) AS text
        FROM "ExerciseAttempt" p JOIN "LearningArtifact" a ON a.id=p."artifactId" AND a.version=p.version
        LEFT JOIN "ExerciseState" s ON s."artifactId"=p."artifactId" AND s.version=p.version AND s."ownerId"=p."ownerId"
        WHERE p."ownerId"=$1 AND p.source->>'language'=$2 AND p."createdAt">=$3
        AND p.correct=false AND p.revealed=false AND p."hintUsed"=false
        AND a.status='ready' AND a."needsReview"=false AND COALESCE(s.excluded,false)=false
        ORDER BY p."createdAt" DESC,p.id LIMIT 10`,
        parameters
      ),
      this.db.query<HistoryRow[]>(
        `SELECT 'expression:' || id AS id,'saved_expression' AS kind,source,left(concat_ws(' / ',text,meaning,note),1500) AS text
        FROM "Expression" WHERE "ownerId"=$1 AND source->>'language'=$2 AND "updatedAt">=$3 AND "reviewIncluded"=true
        ORDER BY "updatedAt" DESC,id LIMIT 10`,
        parameters
      ),
      this.db.query<HistoryRow[]>(
        `SELECT 'annotation:' || id AS id,'annotation' AS kind,source,left(memo,1500) AS text
        FROM "Annotation" WHERE "ownerId"=$1 AND source->>'language'=$2 AND "updatedAt">=$3
        ORDER BY "updatedAt" DESC,id LIMIT 10`,
        parameters
      ),
      this.db.query<HistoryRow[]>(
        `SELECT 'question:' || id AS id,'helper_question' AS kind,source,left(concat_ws(' / ',title,body),1500) AS text
        FROM "LearningQuestion" WHERE "ownerId"=$1 AND source->>'language'=$2 AND "updatedAt">=$3 AND "revokedAt" IS NULL AND kind='question'
        ORDER BY "updatedAt" DESC,id LIMIT 10`,
        parameters
      ),
      this.db.query<HistoryRow[]>(
        `SELECT 'message:' || m.id AS id,'ai_question' AS kind,c.source,left(m.text,1500) AS text
        FROM "AIMessage" m JOIN "AIConversation" c ON c.id=m."conversationId"
        WHERE c."ownerId"=$1 AND c.source->>'language'=$2 AND m."createdAt">=$3 AND m.role='user' AND m.status='ready'
        ORDER BY m."createdAt" DESC,m.id LIMIT 10`,
        parameters
      ),
    ]);

    const evidence: HistoryRow[] = [];

    let remaining = 20000;

    // 활동 종류별로 번갈아 골라 한 종류의 기록이 입력 한도를 모두 차지하지 않게 한다.
    const balanced = Array.from({ length: 10 }, (_, index) =>
      rows.flatMap((group) => (group[index] ? [group[index]] : []))
    ).flat();

    for (const row of balanced) {
      const parsed = sourceInputSchema.safeParse(row.source);

      if (!parsed.success) continue;

      try {
        // 권한 철회·원문 변경 뒤 남은 개인 기록이 외부 모델로 전달되지 않게 재검증한다.
        const current = await this.sources.context(ownerId, {
          ...parsed.data,
          version: undefined,
        });

        if (
          !current.eligibility.aiAllowed ||
          current.source.language !== language ||
          (row.source.version ?? 1) !== current.source.version
        )
          continue;

        const item = {
          id: row.id,
          kind: row.kind,
          text: row.text.slice(0, 600),
          source: {
            ...current.source,
            title: current.source.title.slice(0, 200),
            quote: current.source.quote.slice(0, 500),
            rects: undefined,
          },
        };

        const size = JSON.stringify(item).length;

        if (size > remaining) continue;
        remaining -= size;
        evidence.push(item);
      } catch (error) {
        if (
          !(error instanceof HttpError) ||
          ![400, 403, 404, 409].includes(error.getStatus())
        )
          throw error;
      }
    }

    return {
      days: 30,
      evidence,
      fingerprint: inputFingerprint({ language, evidence }),
    };
  }
}
