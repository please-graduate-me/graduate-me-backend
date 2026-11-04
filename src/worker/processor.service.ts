import { Injectable } from '@nestjs/common';
import {
  ProcessingError,
  processorEventSchema,
  type ProcessorEvent,
} from './contracts.js';

/** 별도 음성 처리 서버의 스트림을 검증하고 취소를 HTTP 연결에 전달한다. */
@Injectable()
export class ProcessorService {
  async run(
    request: { youtubeId: string; operation: 'transcribe' | 'recheck' },
    onEvent: (event: ProcessorEvent) => Promise<void>,
    signal?: AbortSignal
  ): Promise<ProcessorEvent> {
    const url = process.env.PROCESSOR_URL;
    const token = process.env.PROCESSOR_API_TOKEN;

    if (!url || !token || token.length < 32) {
      throw new ProcessingError(
        'PROCESSOR_CONFIG',
        '음성 처리 서버 주소와 인증 토큰을 확인해 주세요.'
      );
    }

    const controller = new AbortController();

    const combined = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(910000),
      ...(signal ? [signal] : []),
    ]);

    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const refreshDeadline = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), 30000);
    };

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let terminal: ProcessorEvent | undefined;
    let stage = 'started';
    let duration = 0;
    let total = 0;

    const accept = async (line: string) => {
      if (terminal) throw new Error('종료 이벤트 뒤에 출력이 있습니다.');
      const event = processorEventSchema.parse(JSON.parse(line));

      if (event.type === 'heartbeat') return;
      if (event.type === 'error') terminal = event;
      else if (request.operation === 'recheck' && event.type === 'rechecked')
        terminal = event;
      else if (
        request.operation === 'transcribe' &&
        event.type === 'downloaded' &&
        stage === 'started'
      ) {
        stage = 'downloaded';
        await onEvent(event);
      } else if (
        request.operation === 'transcribe' &&
        event.type === 'transcribing' &&
        stage === 'downloaded'
      ) {
        duration = event.duration;
        stage = 'transcribing';
        await onEvent(event);
      } else if (
        request.operation === 'transcribe' &&
        event.type === 'complete' &&
        stage === 'transcribing'
      ) {
        if (event.segments.some((segment) => segment.end > duration))
          throw new Error('영상 길이를 벗어난 구절입니다.');
        terminal = event;
      } else throw new Error('처리 이벤트 순서가 올바르지 않습니다.');
    };

    try {
      refreshDeadline();

      const response = await fetch(new URL('/v1/process', url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ version: 1, ...request }),
        signal: combined,
        redirect: 'error',
      });

      if (!response.ok) {
        await response.body?.cancel();
        const retryable = response.status === 429 || response.status >= 500;

        throw new ProcessingError(
          response.status === 401 ? 'PROCESSOR_AUTH' : 'PROCESSOR_HTTP',
          response.status === 401
            ? '음성 처리 서버 인증에 실패했습니다.'
            : '음성 처리 서버가 요청을 처리하지 못했습니다.',
          retryable
        );
      }

      if (
        !response.body ||
        !response.headers.get('content-type')?.includes('application/x-ndjson')
      ) {
        await response.body?.cancel();
        throw new Error('음성 처리 응답 형식이 올바르지 않습니다.');
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;
        refreshDeadline();
        total += value.byteLength;
        if (total > 8 * 1024 * 1024)
          throw new Error('처리 결과 크기가 너무 큽니다.');
        buffer += decoder.decode(value, { stream: true });
        let index: number;

        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index);

          buffer = buffer.slice(index + 1);
          await accept(line);
        }
      }

      buffer += decoder.decode();
      combined.throwIfAborted();
      if (buffer || !terminal)
        throw new Error('처리 결과가 중간에 끊겼습니다.');
      if (terminal.type === 'error')
        throw new ProcessingError(
          terminal.code,
          terminal.message,
          terminal.retryable
        );

      return terminal;
    } catch (error) {
      if (error instanceof ProcessingError) throw error;
      throw new ProcessingError(
        'PROCESSOR_FAILED',
        '음성 처리 서버 연결 또는 결과 검증에 실패했습니다.',
        true
      );
    } finally {
      clearTimeout(idleTimer);
      // DB 소유권 상실이나 저장 실패도 서버의 진행 중인 분석 취소로 이어진다.
      controller.abort();
      await reader?.cancel().catch(() => undefined);
    }
  }
}
