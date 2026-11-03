import type { MigrationInterface, QueryRunner } from 'typeorm';

/** ORM 전환 후에도 직접 INSERT와 워커가 같은 기본값을 사용하게 한다. */
export class TypeormDefaults1793664000001 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    for (const table of [
      'User',
      'Account',
      'Session',
      'Video',
      'Job',
      'Segment',
      'ShareLink',
      'ShareStart',
      'Progress',
      'SegmentState',
    ])
      await runner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text`
      );
    for (const table of ['Job', 'Progress', 'SegmentState'])
      await runner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP`
      );

    await runner.query(
      'ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("token")'
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE "VerificationToken" DROP CONSTRAINT "VerificationToken_pkey"'
    );

    for (const table of ['Job', 'Progress', 'SegmentState'])
      await runner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "updatedAt" DROP DEFAULT`
      );
    for (const table of [
      'User',
      'Account',
      'Session',
      'Video',
      'Job',
      'Segment',
      'ShareLink',
      'ShareStart',
      'Progress',
      'SegmentState',
    ])
      await runner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "id" DROP DEFAULT`
      );
  }
}
