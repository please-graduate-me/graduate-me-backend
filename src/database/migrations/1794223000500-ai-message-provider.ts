import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 공급자 교체 후에도 대화 당시의 실행 공급자를 모델과 함께 보존한다. */
export class AIMessageProvider1794223000500 implements MigrationInterface {
  name = 'AIMessageProvider1794223000500';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "AIMessage" ADD COLUMN provider text');

    await queryRunner.query(
      `UPDATE "AIMessage" SET provider = 'naver' WHERE model IS NOT NULL`
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "AIMessage" DROP COLUMN provider');
  }
}
