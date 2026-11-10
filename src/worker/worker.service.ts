import { Injectable, Logger } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { QueueService } from './queue.service.js';
import { ProcessorService } from './processor.service.js';
import { ProcessingError, type ClaimedJob } from './contracts.js';
import { VideoPreparationService } from './video-preparation.service.js';

/** HTTP 서버 없이 작업을 순서대로 처리하고 종료 시 실행 중인 분석도 중단한다. */
@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    private readonly queue: QueueService,
    private readonly processor: ProcessorService,
    private readonly preparation: VideoPreparationService
  ) {}

  async run(signal: AbortSignal) {
    this.logger.log('NestJS 음성 작업 관리자 시작');

    while (!signal.aborted) {
      try {
        const job = await this.queue.claim();

        if (job) await this.handle(job, signal);
        else await delay(2000, undefined, { signal });
      } catch {
        if (signal.aborted) break;
        this.logger.error('작업 큐 처리 실패');
        await delay(5000, undefined, { signal }).catch(() => undefined);
      }
    }
  }

  async handle(job: ClaimedJob, signal: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();

    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const heartbeat = this.keepAlive(job, controller);

    try {
      const result = await this.processor.run(
        {
          youtubeId: job.youtubeId,
          videoId: job.videoId,
          language: job.language ?? 'en',
          ownerId: job.ownerId ?? null,
        },
        async (event) => {
          if (event.type === 'transcribing')
            await this.queue.transcribing(job, event);
        },
        controller.signal
      );

      if (result.type !== 'complete') throw new Error('완료 결과가 없습니다.');

      // 전사가 저장된 뒤 후속 번역·빈칸이 실패해도 원문 전체 받아쓰기는 보존한다.
      if (await this.queue.complete(job, result, true)) {
        await this.preparation.prepare(job.videoId, controller.signal);
        await this.queue.release(job);
      }
    } catch (error) {
      const failure =
        error instanceof ProcessingError
          ? error
          : new ProcessingError(
              'INTERNAL',
              '처리 중 오류가 발생했습니다. 자동 재시도하지 않습니다.'
            );

      await this.queue.fail(job, failure.code, failure.message);

      this.logger.warn(`작업 실패: ${job.id} (${failure.code})`);
    } finally {
      controller.abort();
      signal.removeEventListener('abort', abort);
      await heartbeat;
    }
  }

  private async keepAlive(job: ClaimedJob, controller: AbortController) {
    try {
      while (!controller.signal.aborted) {
        await delay(10000, undefined, { signal: controller.signal });

        if (!(await this.queue.heartbeat(job))) {
          controller.abort();
          break;
        }
      }
    } catch {
      // DB 연결이 끊기면 소유권을 보장할 수 없으므로 분석도 중단한다.
      controller.abort();
    }
  }
}
