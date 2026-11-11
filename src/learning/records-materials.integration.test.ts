import { PDFDocument } from 'pdf-lib';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { Material } from '../database/entities/Material.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import { HelperProfile } from '../database/entities/HelperProfile.entity.js';
import { MaterialAccess } from '../database/entities/MaterialAccess.entity.js';
import { LearningArtifact } from '../database/entities/LearningArtifact.entity.js';
import { LearningQuestion } from '../database/entities/LearningQuestion.entity.js';
import { QuestionMessage } from '../database/entities/QuestionMessage.entity.js';
import { ReviewEvent } from '../database/entities/ReviewEvent.entity.js';
import { MaterialAccessService } from '../admin/material-access.service.js';
import { WorkspaceAccessService } from '../admin/workspace-access.service.js';
import { AdminService } from '../admin/admin.service.js';
import { ProfileService } from '../users/profile.service.js';
import { QuestionsService } from './questions.service.js';
import { SourceService } from './source.service.js';
import { RecordsService } from './records.service.js';
import { MaterialsService } from './materials.service.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('자료 공개·원본 버전·개인 기록의 저장 경계', () => {
  const db = new DataSource(databaseOptions(testUrl));
  const materials = new MaterialsService(db);
  const sources = new SourceService(db);

  const questions = new QuestionsService(
    db,
    sources,
    new WorkspaceAccessService(db, new AdminService(db))
  );

  const access = new MaterialAccessService(db, questions);
  const records = new RecordsService(db, sources);
  const profiles = new ProfileService(db);

  const owner = randomUUID(),
    reader = randomUUID(),
    other = randomUUID(),
    departing = randomUUID();

  const materialIds: string[] = [];
  const videoId = randomUUID();
  const quote = 'Learning opens doors to new perspectives.';

  const input = {
    title: '학습 자료',
    language: 'en' as const,
    filename: 'source.pdf',
    contentBase64: '',
    pages: [quote, 'A second page.'],
  };

  async function create(userId = owner) {
    const row = await materials.create(userId, input);

    materialIds.push(row.id);

    return row;
  }

  beforeAll(async () => {
    await db.initialize();
    const pdf = await PDFDocument.create();

    input.pages.forEach(() => pdf.addPage([600, 800]));
    input.contentBase64 = Buffer.from(await pdf.save()).toString('base64');

    await db.manager.insert(
      User,
      [owner, reader, other, departing].map((id) => ({
        id,
        name: '테스트 계정',
      }))
    );
  });

  afterAll(async () => {
    if (!db.isInitialized) return;

    await db.manager.delete(Video, { id: videoId });

    await db.manager.delete(User, {
      id: In([owner, reader, other, departing]),
    });

    if (materialIds.length)
      await db.manager.delete(MaterialAccess, {
        id: In(materialIds),
        kind: 'pdf',
      });
    await db.destroy();
  });

  it('타인의 개인 PDF 강제 공개를 차단하고 공용 읽기 위치·메모를 계정별로 보존한다', async () => {
    const material = await create();

    await materials.update(owner, material.id, {
      memo: '작성자만 아는 메모',
      currentPage: 2,
    });

    await expect(
      access.update(other, material.id, {
        kind: 'pdf',
        visibility: 'public',
        allowedUserIds: [],
      })
    ).rejects.toMatchObject({ status: 403 });

    await expect(materials.get(reader, material.id)).rejects.toMatchObject({
      status: 404,
    });

    await access.update(owner, material.id, {
      kind: 'pdf',
      visibility: 'public',
      allowedUserIds: [],
    });

    expect(await materials.get(reader, material.id)).toMatchObject({
      owned: false,
      visibility: 'public',
      currentPage: 1,
      memo: '',
    });

    await materials.update(reader, material.id, {
      memo: '독자의 메모',
      currentPage: 2,
    });

    expect(await materials.get(reader, material.id)).toMatchObject({
      memo: '독자의 메모',
      currentPage: 2,
    });

    expect(await materials.get(owner, material.id)).toMatchObject({
      memo: '작성자만 아는 메모',
      currentPage: 2,
    });

    expect(await materials.get(other, material.id)).toMatchObject({
      memo: '',
      currentPage: 1,
    });

    const listed = (await materials.list(reader)).items.find(
      (row) => row.id === material.id
    );

    expect(listed).toMatchObject({
      owned: false,
      visibility: 'public',
      currentPage: 2,
    });

    expect(listed).not.toHaveProperty('memo');

    await access.update(owner, material.id, {
      kind: 'pdf',
      visibility: 'accounts',
      allowedUserIds: [reader],
    });

    await expect(materials.file(other, material.id)).rejects.toMatchObject({
      status: 404,
    });

    expect(
      (await materials.file(reader, material.id)).content.toString()
    ).toContain('%PDF-');
  });

  it('공용 PDF와 태국어 영상의 실제 언어·열람 권한으로 도우미 후보를 제공한다', async () => {
    const material = await create();

    await access.update(owner, material.id, {
      kind: 'pdf',
      visibility: 'public',
      allowedUserIds: [],
    });

    await db.manager.insert(Video, {
      id: videoId,
      youtubeId: videoId.replaceAll('-', '').slice(0, 11),
      title: '태국어 자료',
      language: 'th',
      ownerId: owner,
      visibility: 'accounts',
      allowedUserIds: [reader],
    });

    await db.manager.insert(Progress, { userId: reader, videoId });

    await db.manager.insert(HelperProfile, {
      userId: other,
      languages: ['en', 'th'],
      materialIds: [material.id, videoId],
      active: true,
    });

    expect(
      (
        await questions.recipients(reader, {
          materialId: material.id,
          language: 'en',
        })
      ).items
    ).toEqual([{ id: other, name: '테스트 계정', languages: ['en', 'th'] }]);

    expect(
      (
        await questions.recipients(reader, {
          materialId: videoId,
          language: 'th',
        })
      ).items
    ).toHaveLength(1);

    await expect(
      questions.recipients(reader, { materialId: videoId, language: 'en' })
    ).rejects.toMatchObject({ status: 400 });

    await access.update(owner, videoId, {
      kind: 'video',
      visibility: 'private',
      allowedUserIds: [],
    });

    await expect(
      questions.recipients(reader, { materialId: videoId, language: 'th' })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('원본 교체 시 과거 파일·발췌와 결과 source를 보존하고 영향을 받은 결과만 재검토 표시한다', async () => {
    const material = await create();

    const source = await sources.resolve(owner, {
      kind: 'pdf',
      materialId: material.id,
      page: 1,
      quote,
    });

    const artifact = await db.manager.save(LearningArtifact, {
      ownerId: owner,
      kind: 'explanation',
      source,
      model: 'mock',
      provider: 'naver',
      reviewStatus: 'verified',
    });

    const pdf = await PDFDocument.create();

    pdf.addPage([600, 800]);

    const replacement = {
      ...input,
      title: '수정 원본',
      pages: ['A changed source page.'],
      contentBase64: Buffer.from(await pdf.save()).toString('base64'),
      expectedVersion: 1,
    };

    expect(
      await materials.replace(owner, material.id, replacement)
    ).toMatchObject({ version: 2, latestVersion: 2 });

    expect(await materials.get(owner, material.id, 1)).toMatchObject({
      version: 1,
      latestVersion: 2,
      pages: input.pages,
      fileUrl: `/api/materials/${material.id}/versions/1/file`,
    });

    expect(
      (await materials.file(owner, material.id, 1)).content.toString()
    ).toBe(Buffer.from(input.contentBase64, 'base64').toString());

    expect(
      (
        await sources.resolve(owner, {
          kind: 'pdf',
          materialId: material.id,
          page: 1,
          quote,
          version: 1,
        })
      ).quote
    ).toBe(quote);

    expect(
      await db.manager.findOneByOrFail(LearningArtifact, { id: artifact.id })
    ).toMatchObject({
      source,
      needsReview: true,
      reviewStatus: 'needs_review',
    });

    await expect(
      materials.replace(owner, material.id, replacement)
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      materials.replace(reader, material.id, {
        ...replacement,
        expectedVersion: 2,
      })
    ).rejects.toMatchObject({ status: 404 });

    expect(
      (await materials.versions(owner, material.id)).items.map(
        (row) => row.version
      )
    ).toEqual([2, 1]);
  });

  it('개인 하이라이트는 소유자만 편집하고 명시적 발췌 공유에는 원본·메모가 포함되지 않는다', async () => {
    const material = await create();

    const source = {
      kind: 'pdf' as const,
      materialId: material.id,
      page: 1,
      quote,
    };

    const annotation = await records.annotate(owner, {
      source,
      color: 'yellow',
      memo: '비공개 하이라이트 메모',
    });

    expect(
      (
        await records.annotate(owner, {
          source,
          color: 'green',
          memo: '중복 메모',
        })
      ).id
    ).toBe(annotation.id);

    await expect(
      records.updateAnnotation(reader, annotation.id, { memo: '침범' })
    ).rejects.toMatchObject({ status: 404 });

    expect(
      (await records.annotations(reader, { materialId: material.id })).items
    ).toEqual([]);

    const shared = await records.share(owner, {
      source,
      visibility: 'accounts',
      allowedUserIds: [reader],
    });

    expect(await records.shared(reader, shared.id)).toEqual({
      id: shared.id,
      source: expect.objectContaining({ quote, version: 1 }),
      createdAt: expect.any(Date),
    });

    expect(
      JSON.stringify(await records.shared(reader, shared.id))
    ).not.toContain('메모');

    await expect(materials.file(reader, material.id)).rejects.toMatchObject({
      status: 404,
    });

    await expect(records.shared(other, shared.id)).rejects.toMatchObject({
      status: 404,
    });

    await records.revoke(owner, shared.id);

    await expect(records.shared(reader, shared.id)).rejects.toMatchObject({
      status: 410,
    });
  });

  it('학습 설정을 영속하고 탈퇴 시 개인 데이터만 삭제하며 타인 질문의 답변·감사 스냅샷은 남긴다', async () => {
    await profiles.update(departing, {
      targetLanguage: 'th',
      explanationLanguage: 'ko',
      level: 'intermediate',
      interests: ['여행'],
    });

    expect(await profiles.get(departing)).toEqual({
      isHelper: false,
      targetLanguage: 'th',
      explanationLanguage: 'ko',
      level: 'intermediate',
      interests: ['여행'],
    });

    const material = await create(departing);

    const question = await db.manager.save(LearningQuestion, {
      ownerId: owner,
      title: '공개 답변 보존',
      body: '질문',
      source: {
        kind: 'pdf',
        materialId: material.id,
        page: 1,
        quote,
        title: input.title,
        language: 'en',
        version: 1,
      },
    });

    const message = await db.manager.save(QuestionMessage, {
      questionId: question.id,
      authorId: departing,
      authorName: '탈퇴 전 이름',
      kind: 'answer',
      body: '공개 답변',
    });

    const event = await db.manager.save(ReviewEvent, {
      actorId: departing,
      actorName: '탈퇴 전 이름',
      action: 'answer_published',
      detail: '공개 답변 게시',
      visibility: 'internal',
    });

    await profiles.remove(departing);
    expect(await db.manager.countBy(Material, { id: material.id })).toBe(0);

    expect(
      await db.manager.countBy(MaterialAccess, {
        id: material.id,
        kind: 'pdf',
      })
    ).toBe(0);

    expect(
      await db.manager.findOneByOrFail(QuestionMessage, { id: message.id })
    ).toMatchObject({
      authorId: null,
      authorName: '탈퇴 전 이름',
      body: '공개 답변',
    });

    expect(
      await db.manager.findOneByOrFail(ReviewEvent, { id: event.id })
    ).toMatchObject({ actorId: null, actorName: '탈퇴 전 이름' });
  });
});
