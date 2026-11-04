import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { WorkerService } from './worker.service.js';
import { RecheckService } from './recheck.service.js';
import { ProcessorService } from './processor.service.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const controller = new AbortController();
  const stop = () => controller.abort();

  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  try {
    const [command, youtubeId, ...options] = process.argv.slice(2);

    if (command === 'recheck') {
      if (!youtubeId || options.some((option) => option !== '--apply')) {
        throw new Error('사용법: recheck 영상ID [--apply]');
      }

      const recheck = app.get(RecheckService);
      const video = await recheck.findVideo(youtubeId);

      const result = await app.get(ProcessorService).run(
        {
          operation: 'recheck',
          youtubeId,
        },
        async () => undefined,
        controller.signal
      );

      if (result.type !== 'rechecked')
        throw new Error('재검사 결과가 없습니다.');

      console.log(
        JSON.stringify(
          await recheck.apply(video.id, result, options.includes('--apply'))
        )
      );
    } else if (!command) {
      await app.get(WorkerService).run(controller.signal);
    } else {
      throw new Error('지원하지 않는 작업 명령입니다.');
    }
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
