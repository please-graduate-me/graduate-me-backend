import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { HttpError } from '../common/http-error.js';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** 실제 PNG 헤더와 원본 비율이 일치한 이미지에만 픽셀 좌표를 연결한다. */
export function validateOcrPng(
  data: Buffer,
  page: { width: number; height: number }
) {
  if (
    data.length < 33 ||
    data.length > 4 * 1024 * 1024 ||
    !data.subarray(0, 8).equals(pngSignature) ||
    data.readUInt32BE(8) !== 13 ||
    data.subarray(12, 16).toString('ascii') !== 'IHDR'
  )
    throw new HttpError(502, 'PDF 페이지 이미지를 확인할 수 없습니다.');

  const width = data.readUInt32BE(16),
    height = data.readUInt32BE(20);

  const scale = 1024 / Math.max(page.width, page.height);

  if (
    !width ||
    !height ||
    width > 1024 ||
    height > 1024 ||
    Math.abs(width - page.width * scale) > 1.1 ||
    Math.abs(height - page.height * scale) > 1.1
  )
    throw new HttpError(
      502,
      'PDF 원본과 페이지 이미지의 영역이 일치하지 않습니다.'
    );

  return { data, width, height };
}

/** 비공개 임시 원본을 고정된 Poppler 인자로만 변환하고 모든 경로를 정리한다. */
@Injectable()
export class PdfRasterizerService {
  async rasterize(page: { data: Buffer; width: number; height: number }) {
    if (
      page.data.length > 10 * 1024 * 1024 ||
      !Number.isFinite(page.width) ||
      !Number.isFinite(page.height) ||
      page.width <= 0 ||
      page.height <= 0
    )
      throw new HttpError(400, '변환할 PDF 페이지를 확인해 주세요.');
    const directory = await mkdtemp(join(tmpdir(), 'graduate-me-ocr-'));

    try {
      await chmod(directory, 0o700);
      const path = join(directory, 'page.pdf');

      await writeFile(path, page.data, { mode: 0o600, flag: 'wx' });

      // PNG는 표준 출력으로 받아 민감한 이미지 파일을 추가로 남기지 않는다.
      const stdout = await new Promise<Buffer>((resolve, reject) =>
        execFile(
          'pdftoppm',
          [
            '-f',
            '1',
            '-l',
            '1',
            '-singlefile',
            '-scale-to',
            '1024',
            '-png',
            path,
          ],
          {
            encoding: 'buffer',
            timeout: 30000,
            maxBuffer: 4 * 1024 * 1024,
            windowsHide: true,
          },
          (error, output) => (error ? reject(error) : resolve(output))
        )
      );

      return validateOcrPng(stdout, page);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        502,
        'PDF 페이지 이미지를 준비하지 못했습니다. 서버의 변환 설정을 확인해 주세요.'
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
