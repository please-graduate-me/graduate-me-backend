import { degrees, PDFDocument } from 'pdf-lib';
import { HttpError } from '../common/http-error.js';

/** 저장 원본의 CropBox와 회전을 고정한 한 페이지만 공급자에게 전달한다. */
export async function extractOcrPage(content: Buffer, pageNumber: number) {
  if (
    content.length > 10 * 1024 * 1024 ||
    content.subarray(0, 5).toString('ascii') !== '%PDF-'
  )
    throw new HttpError(400, '인식할 PDF 원본을 확인해 주세요.');

  try {
    const original = await PDFDocument.load(content, { updateMetadata: false });

    if (
      original.isEncrypted ||
      original.getPageCount() > 200 ||
      pageNumber < 1 ||
      pageNumber > original.getPageCount()
    )
      throw new Error('지원하지 않는 PDF 범위');
    const page = original.getPage(pageNumber - 1);
    const crop = page.getCropBox();
    const media = page.getMediaBox();
    const angle = ((page.getRotation().angle % 360) + 360) % 360;

    if (
      ![0, 90, 180, 270].includes(angle) ||
      ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
      crop.width <= 0 ||
      crop.height <= 0 ||
      crop.x < media.x ||
      crop.y < media.y ||
      crop.x + crop.width > media.x + media.width ||
      crop.y + crop.height > media.y + media.height
    )
      throw new Error('지원하지 않는 PDF 영역');
    // 회전과 CropBox를 새 한 페이지에 고정해 인식 좌표가 표시된 원본 영역과 어긋나지 않게 한다.
    const width = angle % 180 ? crop.height : crop.width;
    const height = angle % 180 ? crop.width : crop.height;
    const output = await PDFDocument.create();
    const target = output.addPage([width, height]);

    if (page.node.Contents()) {
      const embedded = await output.embedPage(page, {
        left: crop.x,
        bottom: crop.y,
        right: crop.x + crop.width,
        top: crop.y + crop.height,
      });

      target.drawPage(embedded, {
        x: angle === 180 ? width : angle === 270 ? width : 0,
        y: angle === 90 || angle === 180 ? height : 0,
        rotate: degrees(-angle),
      });
    }

    const data = Buffer.from(await output.save());

    if (data.length > 10 * 1024 * 1024) throw new Error('PDF 전송 크기 초과');

    return { data, width, height };
  } catch {
    throw new HttpError(
      400,
      '암호화되지 않은 정상 PDF와 페이지 범위를 확인해 주세요.'
    );
  }
}
