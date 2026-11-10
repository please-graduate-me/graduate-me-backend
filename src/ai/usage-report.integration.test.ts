import { randomUUID } from 'node:crypto';
import { DataSource, In } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { AIUsage } from '../database/entities/AIUsage.entity.js';
import { UsageService } from './usage.service.js';
import { usageQuerySchema } from './contracts.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('운영 AI 원장의 전체 필터·페이지·집계', () => {
  const db = new DataSource(databaseOptions(testUrl));

  const userId = randomUUID(),
    marker = randomUUID(),
    ids = Array.from({ length: 105 }, () => randomUUID());

  beforeAll(async () => {
    await db.initialize();
    await db.manager.insert(User, { id: userId, name: `원장 ${marker}` });

    await db.manager.insert(
      AIUsage,
      ids.map((id, index) => ({
        id,
        ownerId: userId,
        provider: index === 103 ? ('naver' as const) : ('anthropic' as const),
        task: index === 104 ? 'old-running' : 'current',
        model: 'mock-model',
        sourceKey: `${marker}:${index}`,
        status:
          index === 103
            ? ('failed' as const)
            : index === 104
              ? ('running' as const)
              : ('succeeded' as const),
        inputTokens: index === 103 ? null : 10,
        outputTokens: index === 103 ? null : 2,
        reservedTokens: 20,
        estimatedCost: index === 103 ? null : 0.0003,
        createdAt: new Date(Date.now() - (index === 104 ? 40 : 0) * 86400000),
      }))
    );
  });

  afterAll(async () => {
    if (db.isInitialized) {
      await db.manager.delete(AIUsage, { id: In(ids) });
      await db.manager.delete(User, { id: userId });
      await db.destroy();
    }
  });

  it('100개를 넘는 전체 원장에서 페이지를 나눠도 같은 필터전체집계를 반환한다', async () => {
    const report = await new UsageService(db).report(
      usageQuerySchema.parse({ q: marker, limit: 20, page: 6 })
    );

    expect(report).toMatchObject({
      total: 105,
      page: 6,
      limit: 20,
      hasMore: false,
      summary: {
        requests: 105,
        succeeded: 103,
        failed: 1,
        running: 1,
        inputTokens: 1040,
        outputTokens: 208,
        reservedTokens: 2100,
        unmeasuredRequests: 1,
      },
    });

    expect(report.items).toHaveLength(5);
    expect(report.summary.estimatedCost).toBeCloseTo(104 * 0.0003);
    expect(report.summary.actualCost).toBeNull();
  });

  it('기간·공급자·상태·사용자 검색을 전체에 적용하고 첫100밖의 과거기록도 검색한다', async () => {
    const service = new UsageService(db);

    const recent = await service.report(
      usageQuerySchema.parse({
        q: marker,
        period: '7',
        provider: 'anthropic',
        status: 'succeeded',
        limit: 10,
      })
    );

    expect(recent).toMatchObject({
      total: 103,
      hasMore: true,
      summary: {
        requests: 103,
        succeeded: 103,
        inputTokens: 1030,
        unmeasuredRequests: 0,
      },
    });

    const old = await service.report(
      usageQuerySchema.parse({ q: `${marker}:104`, status: 'running' })
    );

    expect(old).toMatchObject({
      total: 1,
      summary: { requests: 1, running: 1 },
    });

    expect(old.items[0].task).toBe('old-running');

    expect(
      (
        await service.report(
          usageQuerySchema.parse({ q: marker, period: '30', status: 'running' })
        )
      ).total
    ).toBe(0);

    expect(
      (await service.report(usageQuerySchema.parse({ q: `원장 ${marker}` })))
        .total
    ).toBe(105);

    expect((await service.report()).items.length).toBeLessThanOrEqual(100);
  });
});
