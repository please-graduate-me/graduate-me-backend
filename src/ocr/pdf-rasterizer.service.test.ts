import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('node:child_process', () => ({ execFile: execute }));
import {
  PdfRasterizerService,
  validateOcrPng,
} from './pdf-rasterizer.service.js';

function png(width = 512, height = 1024) {
  const bytes = Buffer.alloc(33);

  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);

  return bytes;
}

beforeEach(() => execute.mockReset());

it('고정 인자와 제한된 출력으로만 변환하고 비공개 임시 원본을 성공·실패 후 정리한다', async () => {
  let temporaryPath = '';
  const page = { data: Buffer.from('%PDF-mock'), width: 400, height: 800 };

  execute.mockImplementationOnce((command, args, options, callback) => {
    temporaryPath = args.at(-1);
    expect(command).toBe('pdftoppm');

    expect(args.slice(0, -1)).toEqual([
      '-f',
      '1',
      '-l',
      '1',
      '-singlefile',
      '-scale-to',
      '1024',
      '-png',
    ]);

    expect(options).toMatchObject({
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'buffer',
    });

    expect(options).not.toHaveProperty('shell');
    expect(statSync(temporaryPath).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(temporaryPath)).mode & 0o777).toBe(0o700);
    expect(readFileSync(temporaryPath)).toEqual(page.data);
    callback(null, png());
  });

  const rasterizer = new PdfRasterizerService();

  expect(await rasterizer.rasterize(page)).toMatchObject({
    width: 512,
    height: 1024,
  });

  expect(existsSync(dirname(temporaryPath))).toBe(false);

  execute.mockImplementationOnce((_, args, __, callback) => {
    temporaryPath = args.at(-1);
    callback(new Error('민감한 원본 경로와 출력'));
  });

  await expect(rasterizer.rasterize(page)).rejects.toMatchObject({
    status: 502,
  });

  expect(existsSync(dirname(temporaryPath))).toBe(false);
});

it('PNG 헤더·실제 크기·원본 비율이 다른 이미지를 인식 입력으로 허용하지 않는다', () => {
  expect(() =>
    validateOcrPng(png(1025, 1024), { width: 400, height: 800 })
  ).toThrow();

  expect(() =>
    validateOcrPng(png(512, 900), { width: 400, height: 800 })
  ).toThrow();

  expect(() =>
    validateOcrPng(Buffer.from('PNG가 아닌 출력'), { width: 400, height: 800 })
  ).toThrow();
});
