import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PracticeAttempt } from '../database/entities/PracticeAttempt.entity.js';
import { MaterialsService } from './materials.service.js';
import { ExpressionsService } from './expressions.service.js';
import { QuestionsService } from './questions.service.js';

@Injectable()
/** 학생 홈과 학습 기록에 본인 자료만 합쳐 제공한다. */
export class LearningService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(MaterialsService) private readonly materials: MaterialsService,
    @Inject(ExpressionsService)
    private readonly expressions: ExpressionsService,
    @Inject(QuestionsService) private readonly questions: QuestionsService
  ) {}
  async summary(userId: string) {
    const [materials, expressions, questions] = await Promise.all([
      this.materials.list(userId),
      this.expressions.list(userId),
      this.questions.list(userId),
    ]);

    return {
      materials: materials.items.length,
      expressions: expressions.items.length,
      questions: questions.items.length,
      unanswered: questions.items.filter((q) => q.status === 'waiting').length,
      recentMaterials: materials.items.slice(0, 6),
      recentExpressions: expressions.items.slice(0, 6),
      recentQuestions: questions.items.slice(0, 6),
    };
  }
  async history(userId: string) {
    const [materials, questions, practice] = await Promise.all([
      this.materials.list(userId),
      this.questions.list(userId),
      this.db.manager.find(PracticeAttempt, {
        where: { ownerId: userId },
        order: { createdAt: 'DESC' },
        take: 100,
      }),
    ]);

    const items = [
      ...materials.items.map((m) => ({
        id: `material:${m.id}`,
        kind: 'material' as const,
        title: m.title,
        detail: `${m.currentPage} / ${m.pageCount}페이지`,
        createdAt: m.updatedAt,
        href: `/materials/${m.id}`,
      })),
      ...questions.items.map((q) => ({
        id: `question:${q.id}`,
        kind: 'question' as const,
        title: q.title,
        detail:
          q.status === 'answered'
            ? '공개 답변이 도착했습니다.'
            : '답변을 기다리고 있습니다.',
        createdAt: q.updatedAt,
        href: `/questions/${q.id}`,
      })),
      ...practice.map((p) => ({
        id: p.id,
        kind: 'practice' as const,
        title: p.snapshot.text,
        detail: p.correct
          ? '자가점검 · 기억했어요'
          : '자가점검 · 다시 연습해요',
        createdAt: p.createdAt,
        href: '/practice',
      })),
    ];

    return {
      items: items
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 100),
    };
  }
}
