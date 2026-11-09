import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import { User } from '../database/entities/User.entity.js';
import { Material } from '../database/entities/Material.entity.js';
import { MaterialAccess } from '../database/entities/MaterialAccess.entity.js';
import { HttpError } from '../common/http-error.js';

/** 목표 언어를 바꾸어도 이전 학습 기록을 삭제하지 않도록 설정만 검증한다. */
export const profileInputSchema = z.object({
  targetLanguage: z.enum(['en', 'th']),
  explanationLanguage: z.enum(['ko', 'en', 'th']),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  interests: z
    .array(z.string().trim().min(1).max(100))
    .max(20)
    .transform((values) => [...new Set(values)]),
});

@Injectable()
/** 학습 설정과 계정 삭제를 세션 계정 안에서만 처리한다. */
export class ProfileService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async get(userId: string) {
    const user = await this.db.manager.findOne(User, {
      where: { id: userId },
      select: {
        targetLanguage: true,
        explanationLanguage: true,
        level: true,
        interests: true,
      },
    });

    if (!user) throw new HttpError(404, '사용자를 찾을 수 없습니다.');

    return user;
  }
  async update(userId: string, input: z.infer<typeof profileInputSchema>) {
    const result = await this.db.manager.update(User, { id: userId }, input);

    if (!result.affected)
      throw new HttpError(404, '사용자를 찾을 수 없습니다.');

    return this.get(userId);
  }
  async remove(userId: string) {
    await this.db.transaction(async (tx) => {
      const user = await tx.findOne(User, {
        where: { id: userId },
        select: { id: true },
        lock: { mode: 'pessimistic_write' },
      });

      if (!user) throw new HttpError(404, '사용자를 찾을 수 없습니다.');

      // 자료별 접근 표는 다형 참조라 계정 삭제 전에 원본의 고아 설정을 함께 정리한다.
      await tx
        .createQueryBuilder()
        .delete()
        .from(MaterialAccess)
        .where('kind = :kind', { kind: 'pdf' })
        .andWhere(
          `id IN (${tx.createQueryBuilder().select('m.id').from(Material, 'm').where('m.ownerId = :userId').getQuery()})`,
          { userId }
        )
        .execute();

      // 개인 데이터는 외래 키 삭제 정책을 따르고 타인 질문의 공개 답변·감사 스냅샷은 남긴다.
      await tx.delete(User, { id: userId });
    });

    return { ok: true };
  }
}
