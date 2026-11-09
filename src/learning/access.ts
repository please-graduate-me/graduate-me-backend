import type { DataSource } from 'typeorm';
import { MaterialAccess } from '../database/entities/MaterialAccess.entity.js';
import { Material } from '../database/entities/Material.entity.js';
import { HttpError } from '../common/http-error.js';

/** 원본 접근 권한은 발췌 공유 링크와 별도로 확인한다. */
export async function readableMaterial(
  db: DataSource,
  userId: string,
  id: string
) {
  const material = await db.manager.findOneBy(Material, { id });

  if (!material) throw new HttpError(404, '자료를 찾을 수 없습니다.');
  if (material.ownerId === userId) return material;

  const access = await db.manager.findOneBy(MaterialAccess, {
    id,
    kind: 'pdf',
  });

  if (
    !access ||
    access.visibility === 'private' ||
    (access.visibility === 'accounts' &&
      !access.allowedUserIds.includes(userId))
  )
    throw new HttpError(404, '자료를 찾을 수 없습니다.');

  return material;
}
