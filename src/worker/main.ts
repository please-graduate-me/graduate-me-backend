import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { WorkerService } from './worker.service.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const controller = new AbortController();
  const stop = () => controller.abort();

  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  try {
    if (process.argv.length > 2)
      throw new Error('지원하지 않는 작업 명령입니다.');
    await app.get(WorkerService).run(controller.signal);
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await app.close();
  }
}

bootstrap().catch(() => {
  console.error('워커 실행 실패: 설정, DB 연결과 처리기 상태를 확인해 주세요.');
  process.exitCode = 1;
});
