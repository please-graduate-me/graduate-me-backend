import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { User } from '../database/entities/User.entity.js';
import { Material } from '../database/entities/Material.entity.js';
import { PracticeAttempt } from '../database/entities/PracticeAttempt.entity.js';
import { AdminService } from '../admin/admin.service.js';
import { WorkspaceAccessService } from '../admin/workspace-access.service.js';
import { WorkspaceQuestionsService } from '../admin/workspace-questions.service.js';
import { WorkspaceOperationsService } from '../admin/workspace-operations.service.js';
import { MaterialsService } from './materials.service.js';
import { SourceService } from './source.service.js';
import { ExpressionsService } from './expressions.service.js';
import { QuestionsService } from './questions.service.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('학생 질문과 admin 답변의 저장·권한 경계', () => {
  const db = new DataSource(databaseOptions(testUrl));
  const materials = new MaterialsService(db);
  const sources = new SourceService(db);
  const access = new WorkspaceAccessService(db, new AdminService(db));
  const questions = new QuestionsService(db, sources, access);
  const workspace = new WorkspaceQuestionsService(db, access, questions);
  const operations = new WorkspaceOperationsService(db, questions);
  const expressions = new ExpressionsService(db, sources);

  const owner = randomUUID(),
    other = randomUUID(),
    helper = randomUUID(),
    admin = randomUUID();

  const helperEmail = `${helper}@example.test`,
    adminEmail = `${admin}@example.test`;

  const quote = 'Learning a language opens doors to new perspectives.';
  let materialId: string, questionId: string;

  beforeAll(async () => {
    await db.initialize();

    await db.manager.insert(User, [
      { id: owner, name: '질문자' },
      { id: other },
      { id: helper, email: helperEmail, name: '답변 도우미' },
      { id: admin, email: adminEmail, name: '운영 관리자' },
    ]);

    vi.stubEnv('ADMIN_EMAILS', adminEmail);

    const material = await materials.create(owner, {
      title: '원문 검증 자료',
      language: 'en',
      filename: 'source.pdf',
      contentBase64: Buffer.from('%PDF-1.7\n%%EOF').toString('base64'),
      pages: [quote],
    });

    materialId = material.id;
  });

  afterAll(async () => {
    if (db.isInitialized) {
      for (const id of [owner, other, helper, admin])
        await db.manager.delete(User, { id });
      await db.destroy();
    }

    vi.unstubAllEnvs();
  });

  it('다른 학생과 배정 도우미에게도 개인 PDF 원본·메모를 공개하지 않는다', async () => {
    await materials.update(owner, materialId, {
      memo: '공유하지 않는 개인 메모',
    });

    await expect(materials.file(other, materialId)).rejects.toMatchObject({
      status: 404,
    });

    await expect(materials.get(helper, materialId)).rejects.toMatchObject({
      status: 404,
    });

    await expect(
      sources.resolve(owner, {
        kind: 'pdf',
        materialId,
        page: 1,
        quote: '원문에 없는 문장',
      })
    ).rejects.toMatchObject({ status: 400 });

    expect((await materials.get(owner, materialId)).memo).toBe(
      '공유하지 않는 개인 메모'
    );
  });

  it('배정 질문만 도우미에게 표시하고 학생에게는 게시한 답변만 전달한다', async () => {
    await operations.saveHelper(admin, {
      email: helperEmail,
      languages: ['en'],
      materialIds: [materialId],
      canReview: true,
      canRequestEdit: true,
      active: true,
    });

    const source = { kind: 'pdf' as const, materialId, page: 1, quote };

    const question = await questions.create(owner, {
      title: '표현의 의미',
      body: '비유적 의미가 궁금합니다.',
      source,
      assigneeId: helper,
    });

    questionId = question.id;

    await workspace.saveDraft(helper, questionId, {
      draft: '공개 전 초안',
      internalNote: '내부 검토 중',
    });

    await expect(questions.get(other, questionId)).rejects.toMatchObject({
      status: 404,
    });

    const before = await questions.get(owner, questionId);

    expect(JSON.stringify(before)).not.toMatch(
      /내부 검토 중|공개 전 초안|공유하지 않는 개인 메모/
    );

    expect(before).not.toHaveProperty('internalNote');

    await workspace.answer(
      helper,
      questionId,
      '새로운 기회를 열어 준다는 비유적 의미입니다.'
    );

    const published = await questions.get(owner, questionId);

    expect(published.status).toBe('answered');

    expect(published.messages).toEqual([
      expect.objectContaining({
        kind: 'answer',
        body: '새로운 기회를 열어 준다는 비유적 의미입니다.',
      }),
    ]);

    await questions.followUp(owner, questionId, '다른 예시도 궁금합니다.');
    expect((await questions.get(owner, questionId)).status).toBe('waiting');
  });

  it('검토 요청과 처리 사유는 버전별로 보존하며 학생 응답에 노출하지 않는다', async () => {
    const detail = await workspace.requestReview(helper, questionId, {
      scope: 'explanation',
      version: 'v1',
      reason: '비유적 의미 보완 요청',
    });

    const review = detail.reviews[0];

    await workspace.resolve(admin, review.id, {
      status: 'resolved',
      resolution:
        '내용 확인 후 도우미 답변으로 안내함. 자동 설명 수정은 하지 않음.',
    });

    await expect(
      workspace.resolve(admin, review.id, {
        status: 'resolved',
        resolution: '중복 처리',
      })
    ).rejects.toMatchObject({ status: 409 });

    expect(
      JSON.stringify(await questions.get(owner, questionId))
    ).not.toContain('비유적 의미 보완 요청');

    expect(
      (await workspace.events(helper)).items.some(
        (e) => e.action === 'review_resolved'
      )
    ).toBe(true);
  });

  it('언어나 자료 권한을 회수하면 기존 배정 질문도 즉시 차단한다', async () => {
    await operations.saveHelper(admin, {
      email: helperEmail,
      languages: ['th'],
      materialIds: [materialId],
      canReview: true,
      canRequestEdit: false,
      active: true,
    });

    expect(
      (await workspace.list(helper, { q: '', page: 1, limit: 100 })).items
    ).toEqual([]);

    await expect(workspace.detail(helper, questionId)).rejects.toMatchObject({
      status: 404,
    });

    await expect(
      workspace.answer(helper, questionId, '접근할 수 없는 답변')
    ).rejects.toMatchObject({ status: 404 });
  });

  it('표현과 원본을 삭제해도 자가점검 당시의 뜻과 근거는 보존한다', async () => {
    const expression = await expressions.create(owner, {
      source: { kind: 'pdf', materialId, page: 1, quote },
      text: 'opens doors',
      meaning: '기회를 열다',
      note: '',
    });

    const result = await expressions.practice(owner, {
      expressionId: expression.id,
      answer: '기회를 열다',
      correct: true,
      mode: 'self',
    });

    await expressions.update(owner, expression.id, { meaning: '다른 뜻' });
    await expressions.remove(owner, expression.id);
    await materials.remove(owner, materialId);

    const attempt = await db.manager.findOneByOrFail(PracticeAttempt, {
      id: result.id,
    });

    expect(attempt.snapshot.meaning).toBe('기회를 열다');
    expect(attempt.snapshot.source.quote).toBe(quote);
    expect((await questions.get(owner, questionId)).source.quote).toBe(quote);

    expect(
      await db.manager.count(Material, { where: { id: materialId } })
    ).toBe(0);
  });
});
