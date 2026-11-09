import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { z } from 'zod';
import { Expression } from '../database/entities/Expression.entity.js';
import { PracticeAttempt } from '../database/entities/PracticeAttempt.entity.js';
import { HttpError } from '../common/http-error.js';
import { normalizedExcerpt, SourceService } from './source.service.js';
import type {
  expressionInputSchema,
  expressionUpdateSchema,
  practiceInputSchema,
} from './contracts.js';

/** 계정 식별자 없이 표현의 공개 가능한 개인 화면 필드를 구성한다. */
export function expressionDetail(row: Expression) {
  return {
    id: row.id,
    text: row.text,
    meaning: row.meaning,
    note: row.note,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
/** 표현집의 개인 뜻·메모와 자가점검 기록을 소유 계정에 한정한다. */
export class ExpressionsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(SourceService) private readonly sources: SourceService
  ) {}
  async owned(userId: string, id: string) {
    const row = await this.db.manager.findOneBy(Expression, {
      id,
      ownerId: userId,
    });

    if (!row) throw new HttpError(404, '저장한 표현을 찾을 수 없습니다.');

    return row;
  }
  async list(userId: string) {
    const rows = await this.db.manager.find(Expression, {
      where: { ownerId: userId },
      order: { updatedAt: 'DESC' },
    });

    return { items: rows.map(expressionDetail) };
  }
  async create(userId: string, input: z.infer<typeof expressionInputSchema>) {
    const source = await this.sources.resolve(userId, input.source);

    if (
      !normalizedExcerpt(source.quote).includes(normalizedExcerpt(input.text))
    )
      throw new HttpError(400, '표현을 선택한 발췌에서 확인할 수 없습니다.');

    const row = await this.db.manager.save(Expression, {
      ownerId: userId,
      text: input.text,
      meaning: input.meaning,
      note: input.note,
      source,
    });

    return expressionDetail(row);
  }
  async update(
    userId: string,
    id: string,
    input: z.infer<typeof expressionUpdateSchema>
  ) {
    await this.owned(userId, id);
    if (Object.keys(input).length)
      await this.db.manager.update(Expression, { id, ownerId: userId }, input);

    return expressionDetail(await this.owned(userId, id));
  }
  async remove(userId: string, id: string) {
    await this.owned(userId, id);
    await this.db.manager.delete(Expression, { id, ownerId: userId });

    return { ok: true };
  }
  async practice(userId: string, input: z.infer<typeof practiceInputSchema>) {
    const expression = await this.owned(userId, input.expressionId);

    const row = await this.db.manager.save(PracticeAttempt, {
      ownerId: userId,
      expressionId: expression.id,
      answer: input.answer,
      correct: input.correct,
      mode: input.mode,
      snapshot: {
        text: expression.text,
        meaning: expression.meaning,
        source: expression.source,
      },
    });

    return { id: row.id, createdAt: row.createdAt };
  }
}
