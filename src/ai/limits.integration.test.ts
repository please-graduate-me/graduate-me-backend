import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { AIUsage } from '../database/entities/AIUsage.entity.js';
import { AIOperation } from '../database/entities/AIOperation.entity.js';
import { HttpError } from '../common/http-error.js';
import { UsageService } from './usage.service.js';
import { OperationService, inputFingerprint } from './operation.service.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('AI 사용 한도와 중단된 요청의 저장 경계', () => {
  const db = new DataSource(databaseOptions(testUrl));
  const owners = [randomUUID(), randomUUID()];

  beforeAll(async () => {
    await db.initialize();

    await db.manager.insert(
      User,
      owners.map((id) => ({ id }))
    );
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const id of owners) await db.manager.delete(User, { id });
    await db.destroy();
  });

  it('실패·부분 미확인 토큰도 예약량 이상으로 합산해 다음 호출을 차단한다', async () => {
    vi.stubEnv('AI_DAILY_TOKEN_LIMIT', '200000');
    vi.stubEnv('AI_DAILY_REQUEST_LIMIT', '100');
    vi.stubEnv('AI_DAILY_BUDGET_USD', '0');

    await db.manager.insert(AIUsage, [
      {
        ownerId: owners[0],
        provider: 'naver',
        task: 'test',
        model: 'HCX-007',
        sourceKey: 'failed',
        status: 'failed',
        reservedTokens: 110000,
      },
      {
        ownerId: owners[0],
        provider: 'naver',
        task: 'test',
        model: 'HCX-007',
        sourceKey: 'partial',
        status: 'succeeded',
        reservedTokens: 90000,
        inputTokens: 5,
        outputTokens: null,
      },
    ]);

    const execute = vi.fn(async () => ({ value: '호출되면 안 됨' }));

    await expect(
      new UsageService(db).execute(
        {
          ownerId: owners[0],
          provider: 'naver',
          task: 'test',
          model: 'HCX-007',
          sourceKey: 'next',
          reservedOutputTokens: 1,
        },
        execute
      )
    ).rejects.toMatchObject({ status: 429 });

    expect(execute).not.toHaveBeenCalled();
  });

  it('중단 요청은 실패로 남기고 새 명시적 요청·캐시·호출 전 제한 복구를 구분한다', async () => {
    const ownerId = owners[1],
      requestId = randomUUID(),
      input = { source: 'one' };

    const service = new OperationService(db);
    const run = vi.fn(async () => ({ saved: true }));

    await db.manager.insert(AIOperation, {
      id: requestId,
      ownerId,
      task: 'explanation',
      fingerprint: inputFingerprint(input),
      status: 'running',
      createdAt: new Date(Date.now() - 31 * 60000),
      updatedAt: new Date(Date.now() - 31 * 60000),
    });

    await expect(
      service.run(ownerId, requestId, 'explanation', input, run)
    ).rejects.toMatchObject({ status: 502 });

    expect(
      await db.manager.findOneBy(AIOperation, { id: requestId })
    ).toMatchObject({ status: 'failed' });

    expect(run).not.toHaveBeenCalled();

    await expect(
      service.run(ownerId, requestId, 'explanation', { source: 'other' }, run)
    ).rejects.toMatchObject({ status: 409 });

    const newId = randomUUID();

    await expect(
      service.run(ownerId, newId, 'explanation', input, run)
    ).resolves.toEqual({ saved: true });

    await expect(
      service.run(ownerId, newId, 'explanation', input, run)
    ).resolves.toEqual({ saved: true });

    expect(run).toHaveBeenCalledTimes(1);

    const deniedId = randomUUID();

    await expect(
      service.run(ownerId, deniedId, 'explanation', input, async () => {
        throw new HttpError(429, '호출 전 한도 도달');
      })
    ).rejects.toMatchObject({ status: 429 });

    expect(
      await db.manager.findOneBy(AIOperation, { id: deniedId })
    ).toBeNull();

    await expect(
      service.run(ownerId, deniedId, 'explanation', input, run)
    ).resolves.toEqual({ saved: true });

    const lateId = randomUUID();

    await expect(
      service.run(ownerId, lateId, 'explanation', input, async () => {
        await db.manager.update(
          AIOperation,
          { id: lateId },
          { status: 'failed' }
        );

        return { saved: true };
      })
    ).rejects.toMatchObject({ status: 409 });

    expect(
      await db.manager.findOneBy(AIOperation, { id: lateId })
    ).toMatchObject({ status: 'failed' });
  });
});
