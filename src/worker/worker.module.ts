import { ClovaProviderService } from '../ai/clova-provider.service.js';
import { AnthropicProviderService } from '../ai/anthropic-provider.service.js';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from '../database/options.js';
import { QueueService } from './queue.service.js';
import { ProcessorService } from './processor.service.js';
import { WorkerService } from './worker.service.js';
import { ProviderService } from '../ai/provider.service.js';
import { UsageService } from '../ai/usage.service.js';
import { VideoPreparationService } from './video-preparation.service.js';

/** API 인증과 HTTP 모듈을 로드하지 않는 독립 실행 구성을 제공한다. */
@Module({
  imports: [TypeOrmModule.forRoot(databaseOptions())],
  providers: [
    QueueService,
    ProcessorService,
    WorkerService,
    ProviderService,
    ClovaProviderService,
    AnthropicProviderService,
    UsageService,
    VideoPreparationService,
  ],
})
export class WorkerModule {}
