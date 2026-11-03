import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { databaseOptions } from './options.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('TypeORM 스키마와 변경 이력', () => {
  const db = new DataSource(databaseOptions(testUrl));

  beforeAll(async () => {
    await db.initialize();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('마이그레이션으로 생성된 DB와 엔티티에 차이가 없다', async () => {
    const changes = await db.driver.createSchemaBuilder().log();

    expect(changes.upQueries).toEqual([]);
  });

  it('이미 완료된 마이그레이션은 다시 실행하지 않는다', async () => {
    expect(await db.runMigrations()).toEqual([]);
  });
});
