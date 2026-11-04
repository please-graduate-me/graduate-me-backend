import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type RequestListener, type Server } from 'node:http';
import { once } from 'node:events';
import { ProcessorService } from './processor.service.js';

const servers: Server[] = [];
const downloaded = { version: 1, type: 'downloaded' };

const transcribing = {
  version: 1,
  type: 'transcribing',
  title: '테스트',
  duration: 3,
  category: null,
  youtubeCategoryId: null,
};

const complete = {
  version: 1,
  type: 'complete',
  filterVersion: 1,
  speechRegions: [{ start: 0, end: 3 }],
  segments: [{ index: 0, start: 1, end: 2, text: 'Hello', words: [] }],
};

const request = { operation: 'transcribe', youtubeId: 'JnfBXjWm7hc' } as const;
const token = 'test-token-'.repeat(4);

async function fixture(handler: RequestListener) {
  const server = createServer(handler);

  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();

  if (!address || typeof address === 'string')
    throw new Error('테스트 서버 포트 없음');
  vi.stubEnv('PROCESSOR_URL', `http://127.0.0.1:${address.port}`);
  vi.stubEnv('PROCESSOR_API_TOKEN', token);

  return new ProcessorService();
}

function output(events: unknown[]) {
  return events.map((event) => JSON.stringify(event) + '\n').join('');
}

afterEach(async () => {
  vi.unstubAllEnvs();

  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        })
    )
  );
});

describe('음성 처리 HTTP 경계', () => {
  it('인증과 요청을 전달하고 분할 수신한 이벤트를 순서대로 처리한다', async () => {
    let received = '';
    let headers: unknown;

    const processor = await fixture((req, res) => {
      headers = req.headers;

      req.on('data', (chunk) => {
        received += chunk;
      });

      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });

        const body = Buffer.from(
          output([
            downloaded,
            { version: 1, type: 'heartbeat' },
            transcribing,
            complete,
          ])
        );

        const split = body.indexOf(Buffer.from('테스트')) + 1;

        res.write(body.subarray(0, split));
        setTimeout(() => res.end(body.subarray(split)), 5);
      });
    });

    const event = vi.fn();

    expect(await processor.run(request, event)).toEqual(complete);
    expect(JSON.parse(received)).toEqual({ version: 1, ...request });
    expect(headers).toMatchObject({ authorization: `Bearer ${token}` });

    expect(event.mock.calls.map(([value]) => value.type)).toEqual([
      'downloaded',
      'transcribing',
    ]);
  });

  it.each([
    [401, 'PROCESSOR_AUTH', false],
    [429, 'PROCESSOR_HTTP', true],
    [503, 'PROCESSOR_HTTP', true],
  ])('HTTP %s의 재시도 여부를 구별한다', async (status, code, retryable) => {
    const processor = await fixture((_req, res) => {
      res.writeHead(status).end();
    });

    await expect(processor.run(request, vi.fn())).rejects.toMatchObject({
      code,
      retryable,
    });
  });

  it.each([
    [complete],
    [
      downloaded,
      transcribing,
      { ...complete, segments: [{ ...complete.segments[0], end: 9 }] },
    ],
    [downloaded, transcribing, complete, downloaded],
    [{ ...downloaded, version: 2 }],
    [downloaded],
  ])(
    '순서·시간·버전 또는 완료 이벤트가 잘못된 응답을 거부한다',
    async (...events) => {
      const processor = await fixture((_req, res) => {
        res
          .writeHead(200, { 'Content-Type': 'application/x-ndjson' })
          .end(output(events));
      });

      await expect(processor.run(request, vi.fn())).rejects.toMatchObject({
        code: 'PROCESSOR_FAILED',
      });
    }
  );

  it('처리기의 실패 코드와 재시도 여부를 보존한다', async () => {
    const processor = await fixture((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' }).end(
        output([
          {
            version: 1,
            type: 'error',
            code: 'NO_SPEECH',
            message: '말소리 없음',
            retryable: false,
          },
        ])
      );
    });

    await expect(processor.run(request, vi.fn())).rejects.toMatchObject({
      code: 'NO_SPEECH',
      retryable: false,
    });
  });

  it('소유권 취소 시 HTTP 연결을 닫아 서버 처리 취소로 전달한다', async () => {
    let disconnected: Promise<unknown> | undefined;

    const processor = await fixture((_req, res) => {
      disconnected = once(res, 'close');
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(output([downloaded]));
    });

    const controller = new AbortController();

    await expect(
      processor.run(request, async () => controller.abort(), controller.signal)
    ).rejects.toMatchObject({ code: 'PROCESSOR_FAILED' });

    await disconnected;
  });

  it('DB 상태 저장 실패 시에도 서버 연결을 닫는다', async () => {
    let disconnected: Promise<unknown> | undefined;

    const processor = await fixture((_req, res) => {
      disconnected = once(res, 'close');
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(output([downloaded]));
    });

    await expect(
      processor.run(request, async () => {
        throw new Error('DB 실패');
      })
    ).rejects.toMatchObject({ code: 'PROCESSOR_FAILED' });

    await disconnected;
  });

  it('종료 JSON이 중간에 잘렸으면 완료로 처리하지 않는다', async () => {
    const processor = await fixture((_req, res) => {
      res
        .writeHead(200, { 'Content-Type': 'application/x-ndjson' })
        .end(output([downloaded, transcribing]) + '{"version":1');
    });

    await expect(processor.run(request, vi.fn())).rejects.toMatchObject({
      code: 'PROCESSOR_FAILED',
    });
  });

  it('재검사도 같은 HTTP 계약으로 반환한다', async () => {
    const result = {
      version: 1,
      type: 'rechecked',
      filterVersion: 1,
      speechRegions: [],
    };

    const processor = await fixture((_req, res) => {
      res
        .writeHead(200, { 'Content-Type': 'application/x-ndjson' })
        .end(output([result]));
    });

    expect(
      await processor.run({ ...request, operation: 'recheck' }, vi.fn())
    ).toEqual(result);
  });
});
