import type { DataSourceOptions } from 'typeorm';
import { entities } from './entities.js';
import { migrations } from './migrations.js';

/** 실행 환경만 Compose에서 주입하고 스키마 변경은 마이그레이션으로 제한한다. */
export function databaseOptions(
  url = process.env.DATABASE_URL
): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities,
    migrations,
    synchronize: false,
    migrationsTableName: 'typeorm_migrations',
    invalidWhereValuesBehavior: { null: 'throw', undefined: 'throw' },
  };
}
