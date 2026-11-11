import { afterEach, expect, it, vi } from 'vitest';
import { MaterialAnalysisRunner } from './material-analysis.runner.js';
import type { MaterialAnalysisService } from './material-analysis.service.js';
import type { MaterialAnalysisProcessor } from './material-analysis.processor.js';

afterEach(() => vi.useRealTimers());

it('서버 종료 시 실행 중 생성을 중단하고 새 작업을 접수하지 않는다', async () => {
  vi.useFakeTimers();

  const queue = {
    claim: vi.fn().mockResolvedValue({ id: 'job' }),
    heartbeat: vi.fn().mockResolvedValue(true),
  };

  let aborted = false;

  const process = vi.fn(
    async (_job: unknown, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            resolve();
          },
          { once: true }
        );
      })
  );

  const runner = new MaterialAnalysisRunner(
    queue as unknown as MaterialAnalysisService,
    { process } as unknown as MaterialAnalysisProcessor
  );

  runner.onApplicationBootstrap();
  await vi.advanceTimersByTimeAsync(2000);
  expect(process).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(4000);
  expect(queue.claim).toHaveBeenCalledOnce();
  await runner.onModuleDestroy();
  expect(aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(queue.claim).toHaveBeenCalledOnce();
});
