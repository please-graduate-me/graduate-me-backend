import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../database/options.js';
import { Job } from '../database/entities/Job.entity.js';
import { Segment } from '../database/entities/Segment.entity.js';
import { User } from '../database/entities/User.entity.js';
import { Video } from '../database/entities/Video.entity.js';
import { Progress } from '../database/entities/Progress.entity.js';
import { ShareLink } from '../database/entities/ShareLink.entity.js';
import { ShareVisit } from '../database/entities/ShareVisit.entity.js';
import { ShareStart } from '../database/entities/ShareStart.entity.js';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sharedLessonSchema } from './contracts.js';
import { SharesService } from './shares.service.js';
import { AdminService } from '../admin/admin.service.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl && !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('별도 테스트 DB만 사용할 수 있습니다.');

describe.skipIf(!testUrl)('공유와 백오피스 DB 통합', () => {
  const db = new DataSource(databaseOptions(testUrl));

  const shares = new SharesService(db),
    admin = new AdminService(db);

  const creatorId = randomUUID(),
    learnerId = randomUUID(),
    outsiderId = randomUUID();

  const videoId = randomUUID(),
    otherVideoId = randomUUID();

  const segments = [randomUUID(), randomUUID(), randomUUID()];
  const otherSegment = randomUUID();
  const email = `${randomUUID()}@example.test`;

  beforeAll(async () => {
    await db.initialize();

    await db.manager.insert(User, [
      { id: creatorId, email },
      { id: learnerId },
      { id: outsiderId },
    ]);

    await db.manager.insert(Video, {
      id: videoId,
      youtubeId: randomUUID().replaceAll('-', '').slice(0, 11),
      title: '공유 검증 영상',
    });

    await db.manager.insert(Job, { videoId, status: 'ready' });

    await db.manager.insert(
      Segment,
      segments.map((id, index) => ({
        id,
        videoId,
        index,
        start: index * 3,
        end: index * 3 + 2,
        text: 'Hello world.',
        words: [],
      }))
    );

    await db.manager.insert(Video, {
      id: otherVideoId,
      youtubeId: randomUUID().replaceAll('-', '').slice(0, 11),
      title: '다른 영상',
    });

    await db.manager.insert(Job, { videoId: otherVideoId, status: 'ready' });

    await db.manager.insert(Segment, {
      id: otherSegment,
      videoId: otherVideoId,
      index: 0,
      start: 1,
      end: 3,
      text: 'Other video.',
      words: [],
    });

    await db.manager.insert(Progress, { userId: creatorId, videoId });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();

    await db.manager.delete(User, {
      id: In([creatorId, learnerId, outsiderId]),
    });

    await db.manager.delete(Video, { id: In([videoId, otherVideoId]) });

    await db.destroy();
  });

  it('영상과 구절 링크를 만들되 타인 기록과 다른 영상의 구절은 공유하지 못한다', async () => {
    const requestId = randomUUID();
    const input = { requestId, videoId, segmentId: segments[2] };

    expect(await shares.create(creatorId, input)).toEqual({
      id: requestId,
      path: `/share/${requestId}`,
    });

    await shares.create(creatorId, input);

    expect(
      await db.manager.count(ShareLink, { where: { id: requestId } })
    ).toBe(1);

    const result = sharedLessonSchema.parse(
      await shares.get(requestId, learnerId)
    );

    expect(result.segment).toEqual({ id: segments[2], start: 6, end: 8 });

    expect(await shares.get(requestId, learnerId)).not.toHaveProperty(
      'creator'
    );

    expect(await shares.get(requestId, learnerId)).not.toHaveProperty(
      'progress'
    );

    await expect(
      shares.create(outsiderId, { requestId: randomUUID(), videoId })
    ).rejects.toMatchObject({ status: 404 });

    for (const segmentId of [otherSegment])
      await expect(
        shares.create(creatorId, {
          requestId: randomUUID(),
          videoId,
          segmentId,
        })
      ).rejects.toMatchObject({ status: 404 });

    await expect(
      shares.create(creatorId, { requestId, videoId })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('반복 방문 요청을 한 번 집계하고 학습 시작은 사용자별로 한 번 집계한다', async () => {
    const id = randomUUID(),
      visitId = randomUUID();

    await shares.create(creatorId, {
      requestId: id,
      videoId,
      segmentId: segments[2],
    });

    await Promise.all([
      shares.visit(id, visitId, learnerId),
      shares.visit(id, visitId, learnerId),
    ]);

    await shares.start(learnerId, id, visitId);
    await shares.start(learnerId, id, visitId);

    expect(await db.manager.count(ShareVisit, { where: { shareId: id } })).toBe(
      1
    );

    expect(await db.manager.count(ShareStart, { where: { shareId: id } })).toBe(
      1
    );

    expect(
      await db.manager.findOne(Progress, {
        where: { userId: learnerId, videoId },
      })
    ).toMatchObject({ currentIndex: 2 });

    expect(
      await db.manager.findOne(Progress, {
        where: { userId: creatorId, videoId },
      })
    ).toMatchObject({ currentIndex: 0 });
  });

  it('영상 전체 공유는 기존 진도를 보존하며 제거된 목록을 복원한다', async () => {
    const id = randomUUID();

    await shares.create(creatorId, { requestId: id, videoId });

    await db.manager.update(
      Progress,
      { userId: learnerId, videoId },
      { currentIndex: 2, archivedAt: new Date() }
    );

    await shares.start(learnerId, id, randomUUID());

    expect(
      await db.manager.findOne(Progress, {
        where: { userId: learnerId, videoId },
      })
    ).toMatchObject({ currentIndex: 2, archivedAt: null });
  });

  it('관리자 이메일을 명시하지 않으면 누구도 관리자로 판정하지 않는다', async () => {
    vi.stubEnv('ADMIN_EMAILS', '');
    expect(await admin.allowed(creatorId)).toBe(false);
    vi.stubEnv('ADMIN_EMAILS', ` ${email.toUpperCase()} `);
    expect(await admin.allowed(creatorId)).toBe(true);
    expect(await admin.allowed(learnerId)).toBe(false);
    const listing = await admin.shares({ page: 1, limit: 20, q: email });

    expect(listing.items.length).toBeGreaterThan(0);

    expect(listing.items.every((item) => item.creator?.email === email)).toBe(
      true
    );
  });

  it('공유를 중지하면 조회와 방문·시작이 차단되고 통계는 보존된다', async () => {
    const id = randomUUID();

    await shares.create(creatorId, { requestId: id, videoId });
    await shares.visit(id, randomUUID(), learnerId);
    await admin.revoke(id);
    await admin.revoke(id);

    await expect(shares.get(id, learnerId)).rejects.toMatchObject({
      status: 404,
    });

    await expect(
      shares.visit(id, randomUUID(), learnerId)
    ).rejects.toMatchObject({
      status: 404,
    });

    await expect(
      shares.start(learnerId, id, randomUUID())
    ).rejects.toMatchObject({ status: 404 });

    expect(await db.manager.count(ShareVisit, { where: { shareId: id } })).toBe(
      1
    );
  });

  it('공유 링크도 현재 원본 ACL을 적용하며 허가된 수신자의 학습은 유지한다', async () => {
    const id = randomUUID();

    await shares.create(creatorId, { requestId: id, videoId });
    await shares.visit(id, randomUUID(), creatorId);

    try {
      for (const visibility of ['private', 'accounts'] as const) {
        await db.manager.update(
          Video,
          { id: videoId },
          {
            visibility,
            ownerId: creatorId,
            allowedUserIds: [learnerId],
          }
        );

        await expect(shares.get(id, outsiderId)).rejects.toMatchObject({
          status: 404,
        });

        await expect(
          shares.visit(id, randomUUID(), outsiderId)
        ).rejects.toMatchObject({ status: 404 });

        await expect(
          shares.start(outsiderId, id, randomUUID())
        ).rejects.toMatchObject({ status: 404 });

        expect((await shares.get(id, creatorId)).video.id).toBe(videoId);
      }

      expect((await shares.get(id, learnerId)).video.id).toBe(videoId);
      await shares.start(learnerId, id, randomUUID());
      await shares.create(learnerId, { requestId: randomUUID(), videoId });

      await db.manager.update(
        Video,
        { id: videoId },
        { visibility: 'private' }
      );

      await expect(
        shares.create(learnerId, { requestId: randomUUID(), videoId })
      ).rejects.toMatchObject({ status: 404 });

      expect(await db.manager.countBy(ShareVisit, { shareId: id })).toBe(2);

      expect(
        await db.manager.countBy(Progress, { userId: outsiderId, videoId })
      ).toBe(0);
    } finally {
      await db.manager.update(
        Video,
        { id: videoId },
        { visibility: 'public', ownerId: null, allowedUserIds: [] }
      );
    }
  });

  it('공유자 탈퇴 후에도 공용 링크와 방문 집계를 유지한다', async () => {
    const removedId = randomUUID(),
      id = randomUUID();

    await db.manager.insert(User, { id: removedId });
    await db.manager.insert(Progress, { userId: removedId, videoId });

    await shares.create(removedId, { requestId: id, videoId });
    await shares.visit(id, randomUUID(), learnerId);
    await db.manager.delete(User, { id: removedId });

    expect(
      (await db.manager.findOne(ShareLink, { where: { id } }))?.creatorId
    ).toBeNull();

    expect((await shares.get(id, learnerId)).video.id).toBe(videoId);

    expect(await db.manager.count(ShareVisit, { where: { shareId: id } })).toBe(
      1
    );
  });
});
