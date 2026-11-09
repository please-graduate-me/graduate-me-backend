import { assessLearningText } from './material-policy.js';
import { MaterialOcrPage } from '../database/entities/MaterialOcrPage.entity.js';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { Progress } from '../database/entities/Progress.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { requireReadableVideo } from '../videos/access.js';
import { HttpError } from '../common/http-error.js';
import { readableMaterial } from './access.js';
import { SourceRevision } from '../database/entities/SourceRevision.entity.js';
import { MaterialVersion } from '../database/entities/MaterialVersion.entity.js';
import type { LearningSource, SourceInput } from './contracts.js';

/** PDF 글자 조각 사이의 배치 공백을 제외하고 발췌 포함 여부를 비교한다. */
export function normalizedExcerpt(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, '');
}

@Injectable()
/** 질문과 표현 저장이 같은 원문 접근·발췌 검증을 사용하게 한다. */
export class SourceService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  private async pdfSnapshot(userId: string, id: string, version?: number) {
    const material = await readableMaterial(this.db, userId, id);

    if (version === undefined || version === material.version) return material;

    const historical = await this.db.manager.findOneBy(MaterialVersion, {
      materialId: id,
      version,
    });

    if (!historical)
      throw new HttpError(404, '해당 PDF 원본 버전을 찾을 수 없습니다.');

    return {
      ...material,
      ...historical,
      id: material.id,
      ownerId: material.ownerId,
    };
  }
  async resolve(userId: string, input: SourceInput): Promise<LearningSource> {
    let text: string;
    let source: LearningSource;

    if (input.kind === 'pdf') {
      const material = await this.pdfSnapshot(
        userId,
        input.materialId,
        input.version
      );

      if (!material || input.page > material.pages.length)
        throw new HttpError(404, '원문 자료를 찾을 수 없습니다.');
      if (input.ocrId) {
        const ocr = await this.db.manager.findOneBy(MaterialOcrPage, {
          id: input.ocrId,
          materialId: material.id,
          version: material.version,
          page: input.page,
          status: 'ready',
        });

        if (!ocr)
          throw new HttpError(
            404,
            '이 원본 버전과 페이지의 OCR 결과를 찾을 수 없습니다.'
          );
        text = ocr.text;
      } else text = material.pages[input.page - 1];

      source = {
        ...input,
        version: material.version,
        title: material.title,
        language: material.language,
      };
    } else {
      const progress = await this.db.manager.findOneBy(Progress, {
        userId,
        videoId: input.videoId,
        archivedAt: IsNull(),
      });

      const segment =
        progress &&
        (await this.db.manager.findOneBy(Segment, {
          id: input.segmentId,
          videoId: input.videoId,
        }));

      const video =
        segment && (await requireReadableVideo(this.db, userId, input.videoId));

      if (!segment || !video)
        throw new HttpError(404, '학습 원문을 찾을 수 없습니다.');

      const historical =
        input.version && input.version !== segment.version
          ? await this.db.manager.findOneBy(SourceRevision, {
              segmentId: segment.id,
              version: input.version,
            })
          : null;

      if (input.version && input.version !== segment.version && !historical)
        throw new HttpError(409, '이 원문 버전을 찾을 수 없습니다.');
      text = historical ? String(historical.payload.text) : segment.text;

      source = {
        ...input,
        title: video.title,
        language: video.language,
        version: input.version ?? segment.version,
        start: historical ? Number(historical.payload.start) : segment.start,
        end: historical ? Number(historical.payload.end) : segment.end,
        youtubeId: video.youtubeId,
      };
    }

    if (!normalizedExcerpt(text).includes(normalizedExcerpt(input.quote)))
      throw new HttpError(400, '선택한 발췌를 원문에서 확인할 수 없습니다.');

    return source;
  }
  async videoArchive(
    userId: string,
    videoId: string,
    segmentId: string,
    version: number
  ) {
    await requireReadableVideo(this.db, userId, videoId);

    const progress = await this.db.manager.findOneBy(Progress, {
      userId,
      videoId,
      archivedAt: IsNull(),
    });

    const segment =
      progress &&
      (await this.db.manager.findOneBy(Segment, { id: segmentId, videoId }));

    if (!segment) throw new HttpError(404, '학습 원문을 찾을 수 없습니다.');
    // 현재 정답은 기존 정답 열람 경로에서만 공개하고 과거 기록만 조회한다.
    if (version >= segment.version)
      throw new HttpError(409, '보존된 과거 원문 버전만 조회할 수 있습니다.');

    const revision = await this.db.manager.findOneBy(SourceRevision, {
      segmentId,
      version,
    });

    if (!revision)
      throw new HttpError(404, '해당 원문 버전을 찾을 수 없습니다.');
    const text = String(revision.payload.text);

    const source = await this.resolve(userId, {
      kind: 'video',
      videoId,
      segmentId,
      quote: text,
      version,
    });

    return {
      source,
      text,
      translation:
        typeof revision.payload.translation === 'string'
          ? revision.payload.translation
          : null,
      blankCandidates: Array.isArray(revision.payload.blankCandidates)
        ? (revision.payload.blankCandidates as number[])
        : null,
      version,
      currentVersion: segment.version,
    };
  }
  async context(userId: string, input: SourceInput) {
    const source = await this.resolve(userId, input);

    if (source.kind === 'pdf') {
      const material = await this.pdfSnapshot(
        userId,
        source.materialId,
        source.version
      );

      if (source.ocrId) {
        const ocr = await this.db.manager.findOneByOrFail(MaterialOcrPage, {
          id: source.ocrId,
          materialId: source.materialId,
          version: source.version,
          page: source.page,
          status: 'ready',
        });

        const adjacent = [source.page - 1, source.page + 1]
          .filter((page) => page > 0 && page <= material.pages.length)
          .map(
            (page) =>
              `[인접 ${page}페이지의 원본 추출 텍스트]\n${material.pages[page - 1]}`
          )
          .join('\n');

        return {
          source,
          eligibility: assessLearningText(ocr.text, source.language),
          contextDescription: `PDF v${source.version} · ${source.page}페이지 OCR 인식 결과와 인접 페이지 원본 추출 텍스트 · 최대 24000자`,
          context:
            `[선택 페이지 OCR 인식 결과, 원본 대조 필요]\n${ocr.text.slice(0, 16000)}\n${adjacent.slice(0, 8000)}`.slice(
              0,
              24000
            ),
        };
      }

      return {
        source,
        eligibility: assessLearningText(
          material.pages[source.page - 1],
          source.language
        ),
        contextDescription: `PDF v${source.version} · ${Math.max(1, source.page - 1)}~${Math.min(material.pages.length, source.page + 1)}페이지 · 최대 24000자`,
        context: material.pages
          .slice(
            Math.max(0, source.page - 2),
            Math.min(material.pages.length, source.page + 1)
          )
          .join('\n')
          .slice(0, 24000),
      };
    }

    const segment = await this.db.manager.findOneBy(Segment, {
      id: source.segmentId,
      videoId: source.videoId,
    });

    if (segment && source.version !== segment.version) {
      const revision = await this.db.manager.findOneBy(SourceRevision, {
        segmentId: segment.id,
        version: source.version,
      });

      return {
        source,
        eligibility: assessLearningText(
          String(revision?.payload.text ?? source.quote),
          source.language
        ),
        context: String(revision?.payload.text ?? source.quote).slice(0, 24000),
        contextDescription: `보존된 선택 구절 v${source.version} 원문(현재 버전의 인접 구절 제외)`,
      };
    }

    const rows = segment
      ? await this.db
          .getRepository(Segment)
          .createQueryBuilder('s')
          .where('s.videoId=:id AND s.index BETWEEN :from AND :to', {
            id: source.videoId,
            from: Math.max(0, segment.index - 2),
            to: segment.index + 2,
          })
          .orderBy('s.index', 'ASC')
          .getMany()
      : [];

    return {
      source,
      eligibility: assessLearningText(
        segment?.text ?? source.quote,
        source.language
      ),
      contextDescription: `선택 구절 v${source.version}와 앞뒤 최대 2구절의 현재 전사문 · 최대 24000자`,
      context: rows
        .map((r) => r.text)
        .join('\n')
        .slice(0, 24000),
    };
  }
}
