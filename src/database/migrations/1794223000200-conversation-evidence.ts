import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 대화 당시 실제 전달한 문맥 범위를 결과와 함께 보존한다. */
export class ConversationEvidence1794223000200 implements MigrationInterface {
  name = 'ConversationEvidence1794223000200';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "AIMessage" ADD COLUMN "contextDescription" text'
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "AIMessage" DROP COLUMN "contextDescription"'
    );
  }
}
