import { describe, expect, it } from 'vitest';
import { publicVideoQuerySchema } from './catalog-contracts.js';
import { actionSchema } from './actions.js';

describe('공용 영상 조회 계약', () => {
  it('기본 인기순과 페이지 크기를 적용한다', () => {
    expect(publicVideoQuerySchema.parse({})).toEqual({
      sort: 'popular',
      page: 1,
      limit: 20,
    });

    expect(
      publicVideoQuerySchema.parse({
        category: ' 교육 ',
        page: '2',
        limit: '5',
      })
    ).toMatchObject({ category: '교육', page: 2, limit: 5 });
  });

  it('과도한 조회와 잘못된 정렬을 거부한다', () => {
    for (const query of [
      { limit: 51 },
      { page: 0 },
      { page: 1.5 },
      { sort: 'random' },
      { category: ['교육'] },
    ])
      expect(publicVideoQuerySchema.safeParse(query).success).toBe(false);
  });

  it('안 들리는 구절 표시는 모드에 종속되지 않는다', () => {
    expect(
      actionSchema.parse({
        action: 'difficulty',
        segmentId: 'segment',
        marked: true,
      })
    ).toEqual({ action: 'difficulty', segmentId: 'segment', marked: true });

    expect(
      actionSchema.safeParse({
        action: 'difficulty',
        segmentId: 'segment',
        marked: 'false',
      }).success
    ).toBe(false);
  });
});
