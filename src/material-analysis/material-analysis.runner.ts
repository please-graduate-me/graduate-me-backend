import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { MaterialAnalysisService } from './material-analysis.service.js';
import { MaterialAnalysisProcessor } from './material-analysis.processor.js';

/** HTTP 응답과 분리된 DB 작업만 처리하고 서버 종료 시 실행 중 요청을 중단한다. */
@Injectable()
export class MaterialAnalysisRunner
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MaterialAnalysisRunner.name);
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;
  constructor(
    @Inject(MaterialAnalysisService)
    private readonly queue: MaterialAnalysisService,
    @Inject(MaterialAnalysisProcessor)
    private readonly processor: MaterialAnalysisProcessor
  ) {}
  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      if (this.running || this.controller.signal.aborted) return;

      this.running = this.runOne()
        .catch(() => this.logger.error('PDF 분석 작업 처리 실패'))
        .finally(() => {
          this.running = undefined;
        });
    }, 2000);

    this.timer.unref();
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    this.controller.abort();
    await this.running;
  }
  private async runOne() {
    const job = await this.queue.claim();

    if (!job) return;
    const controller = new AbortController();
    const stop = () => controller.abort();

    this.controller.signal.addEventListener('abort', stop, { once: true });
    if (this.controller.signal.aborted) controller.abort();

    const heartbeat = setInterval(() => {
      void this.queue
        .heartbeat(job)
        .then((owned) => {
          if (!owned) controller.abort();
        })
        .catch(() => controller.abort());
    }, 20000);

    try {
      await this.processor.process(job, controller.signal);
    } finally {
      clearInterval(heartbeat);
      this.controller.signal.removeEventListener('abort', stop);
    }
  }
}
