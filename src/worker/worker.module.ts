import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from '../database/options.js';
import { QueueService } from './queue.service.js';
import { ProcessorService } from './processor.service.js';
import { WorkerService } from './worker.service.js';

/** API 인증과 HTTP 모듈을 로드하지 않는 독립 실행 구성을 제공한다. */
@Module({
  imports: [TypeOrmModule.forRoot(databaseOptions())],
  providers: [QueueService, ProcessorService, WorkerService],
})
export class WorkerModule {}
