import type { QueryRunner } from 'typeorm';

/** 기존 배포 이력을 인계해 이미 생성된 테이블과 데이터를 덮어쓰지 않는다. */
export async function applyLegacyMigration(
  runner: QueryRunner,
  name: string,
  sql: string
) {
  if (await runner.hasTable('_prisma_migrations')) {
    const applied: { migration_name: string }[] = await runner.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
      [name]
    );

    if (applied.length) return;
  }

  await runner.query(sql);
}
