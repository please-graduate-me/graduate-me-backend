import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, LessThan } from 'typeorm';
import { AIOperation } from '../database/entities/AIOperation.entity.js';
import { AIUsage } from '../database/entities/AIUsage.entity.js';
import { HttpError } from '../common/http-error.js';

/** 입력 순서와 관계없이 원문·버전·옵션의 지문을 안정적으로 만든다. */
export function inputFingerprint(value: unknown): string {
  const normalize = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, normalize(v)])
          )
        : v;

  return createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex');
}

/** 중복 클릭과 응답 재전송을 한 생성 결과에 연결한다. */
@Injectable()
export class OperationService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async run<T extends Record<string, unknown>>(
    ownerId: string,
    requestId: string,
    task: string,
    input: unknown,
    run: () => Promise<T>
  ): Promise<T> {
    const fingerprint = inputFingerprint(input);

    // 실패 응답의 롤백과 무관하게 중단된 작업을 종료하며 재실행은 명시적 새 요청에 맡긴다.
    await this.db.manager.update(
      AIOperation,
      {
        ownerId,
        status: 'running',
        updatedAt: LessThan(new Date(Date.now() - 30 * 60000)),
      },
      {
        status: 'failed',
        error:
          '처리 프로세스가 중단되어 요청을 종료했습니다. 자동 재시도하지 않습니다.',
      }
    );

    const cached = await this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `ai-operation:${requestId}`,
      ]);

      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `ai-fingerprint:${ownerId}:${task}:${fingerprint}`,
      ]);

      const old = await tx.findOneBy(AIOperation, { id: requestId });

      if (old) {
        if (
          old.ownerId !== ownerId ||
          old.task !== task ||
          old.fingerprint !== fingerprint
        )
          throw new HttpError(409, '이미 다른 요청에 사용한 식별자입니다.');
        if (old.status === 'succeeded') return old.result as T;
        if (old.status === 'failed')
          throw new HttpError(
            502,
            old.error || '이 요청은 실패로 종료되었습니다.',
            'AI_OPERATION_FAILED'
          );
        throw new HttpError(
          409,
          '같은 요청이 처리 중입니다. 저장된 결과를 잠시 후 확인해 주세요.'
        );
      }

      const pending = await tx.findOneBy(AIOperation, {
        ownerId,
        task,
        fingerprint,
        status: 'running',
      });

      if (pending)
        throw new HttpError(
          409,
          '같은 원문 요청을 처리 중입니다. 결과를 잠시 후 확인해 주세요.'
        );

      await tx.insert(AIOperation, {
        id: requestId,
        ownerId,
        task,
        fingerprint,
        status: 'running',
      });

      return null;
    });

    if (cached) return cached;

    try {
      const result = await run();

      const completed = await this.db
        .createQueryBuilder()
        .update(AIOperation)
        .set({ status: 'succeeded', result: () => ':result' })
        .where('id = :id AND "ownerId" = :ownerId AND status = :status', {
          id: requestId,
          ownerId,
          status: 'running',
        })
        .setParameter('result', JSON.stringify(result))
        .execute();

      // 중단 판정 뒤 늦게 도착한 응답으로 실패 기록을 되살리지 않는다.
      if (!completed.affected)
        throw new HttpError(
          409,
          '이미 종료된 요청입니다. 저장된 결과를 확인해 주세요.'
        );

      return result;
    } catch (error) {
      const executed = await this.db.manager.exists(AIUsage, {
        where: { ownerId, requestId },
      });

      if (
        error instanceof HttpError &&
        [429, 503].includes(error.getStatus()) &&
        !executed
      ) {
        await this.db.manager.delete(AIOperation, { id: requestId });
        throw error;
      }

      await this.db.manager.update(
        AIOperation,
        { id: requestId, ownerId, status: 'running' },
        {
          status: 'failed',
          error:
            error instanceof HttpError
              ? error.message
              : 'AI 처리 또는 결과 검증에 실패했습니다.',
        }
      );

      if (executed)
        await this.db.manager.update(
          AIUsage,
          { ownerId, requestId, status: 'succeeded' },
          {
            status: 'failed',
            error: '생성 결과의 근거·학습 형식 검증에 실패했습니다.',
          }
        );
      throw error;
    }
  }
}
