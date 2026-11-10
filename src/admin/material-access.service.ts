import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { z } from 'zod';
import { Material } from '../database/entities/Material.entity.js';
import { MaterialAccess } from '../database/entities/MaterialAccess.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { User } from '../database/entities/User.entity.js';
import { QuestionsService } from '../learning/questions.service.js';
import { HttpError } from '../common/http-error.js';

/** 자료 공개와 계정별 열람 범위를 명시적으로 검증한다. */
export const materialAccessInputSchema = z
  .object({
    kind: z.enum(['pdf', 'video']),
    visibility: z.enum(['private', 'public', 'accounts']),
    allowedUserIds: z
      .array(z.string().trim().min(1).max(128))
      .max(100)
      .transform((ids) => [...new Set(ids)]),
  })
  .refine(
    (input) =>
      input.visibility !== 'accounts' || input.allowedUserIds.length > 0,
    { message: '열람 가능한 계정을 한 명 이상 선택해 주세요.' }
  );

/** 타인의 개인 자료를 강제 공개하지 않고 기존 공용 자료의 접근 범위를 관리한다. */
@Injectable()
export class MaterialAccessService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(QuestionsService) private readonly questions: QuestionsService
  ) {}
  async get(id: string, kind: 'pdf' | 'video') {
    if (kind === 'video') {
      const row = await this.db.manager.findOneBy(Video, { id });

      if (!row) throw new HttpError(404, '영상 자료를 찾을 수 없습니다.');

      return {
        id,
        kind,
        ownerId: row.ownerId,
        visibility: row.visibility,
        allowedUserIds: row.allowedUserIds,
        version: row.version,
      };
    }

    const row = await this.db.manager.findOneBy(Material, { id });

    if (!row) throw new HttpError(404, 'PDF 자료를 찾을 수 없습니다.');

    const access = await this.db.manager.findOneBy(MaterialAccess, {
      id,
      kind,
    });

    return {
      id,
      kind,
      ownerId: row.ownerId,
      visibility: access?.visibility ?? 'private',
      allowedUserIds: access?.allowedUserIds ?? [],
      version: row.version,
    };
  }
  async update(
    actorId: string,
    id: string,
    input: z.infer<typeof materialAccessInputSchema>
  ) {
    await this.db.transaction(async (tx) => {
      const ids = input.visibility === 'accounts' ? input.allowedUserIds : [];

      if (
        ids.length &&
        (await tx.countBy(User, { id: In(ids) })) !== ids.length
      )
        throw new HttpError(
          400,
          '등록된 계정 ID만 열람 대상으로 지정할 수 있습니다.'
        );
      let version: number;

      if (input.kind === 'pdf') {
        const row = await tx.findOne(Material, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });

        if (!row) throw new HttpError(404, 'PDF 자료를 찾을 수 없습니다.');
        const current = await tx.findOneBy(MaterialAccess, { id, kind: 'pdf' });

        // 운영 권한으로 타인의 비공개 PDF를 임의 공개하지 못하게 한다.
        if (row.ownerId !== actorId && current?.visibility !== 'public')
          throw new HttpError(
            403,
            '본인이 등록했거나 이미 공용인 자료만 공개 범위를 변경할 수 있습니다.'
          );
        version = row.version;
      } else {
        const row = await tx.findOne(Video, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });

        if (!row) throw new HttpError(404, '영상 자료를 찾을 수 없습니다.');
        if (row.ownerId !== actorId && row.visibility !== 'public')
          throw new HttpError(
            403,
            '본인이 등록했거나 이미 공용인 자료만 공개 범위를 변경할 수 있습니다.'
          );
        version = row.version;

        await tx.update(
          Video,
          { id },
          { visibility: input.visibility, allowedUserIds: ids }
        );
      }

      // 접근 범위 수정만으로 원문·개인 기록의 버전은 바꾸지 않는다.
      await tx.upsert(
        MaterialAccess,
        {
          id,
          kind: input.kind,
          visibility: input.visibility,
          allowedUserIds: ids,
          version,
        },
        ['id', 'kind']
      );

      await this.questions.event(
        tx,
        actorId,
        null,
        'material_access_changed',
        `${input.kind} 자료 ${id}의 공개 범위를 ${input.visibility}로 변경했습니다.`
      );
    });

    return this.get(id, input.kind);
  }
}
