import {
  TableColumn,
  type MigrationInterface,
  type QueryRunner,
} from 'typeorm';

/** 기존 CLOVA 결과의 출처를 보존하고 이후 OCR 공급자를 구분한다. */
export class OcrProvider1794223000400 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.addColumns('MaterialOcrPage', [
      new TableColumn({ name: 'provider', type: 'text', default: "'naver'" }),
      new TableColumn({
        name: 'model',
        type: 'text',
        default: "'CLOVA OCR General V2'",
      }),
    ]);
  }
  async down(): Promise<void> {
    throw new Error(
      'OCR 출처 이력을 보호하기 위해 후속 마이그레이션으로 변경해 주세요.'
    );
  }
}
