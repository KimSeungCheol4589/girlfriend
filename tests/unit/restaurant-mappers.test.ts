import { describe, expect, it } from 'vitest';

import { buildPage, sortReviews, toDetail, toListItem, toReview } from '@/features/restaurants/mappers';

function row(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `맛집 ${index}`,
    area: '성수',
    category: '양식',
    status: 'wishlist',
    visited_date: null,
    created_at: `2026-09-21T00:00:${String(59 - index).padStart(2, '0')}.000001+00:00`,
    ...overrides,
  };
}

describe('buildPage', () => {
  it('pageSize+1개를 읽으면 pageSize개와 마지막 항목의 (created_at, id) 커서를 돌려준다', () => {
    const rows = [row(1), row(2), row(3)];
    const page = buildPage(rows, 2);
    expect(page?.items.map((item) => item.id)).toEqual([rows[0]?.id, rows[1]?.id]);
    expect(page?.nextCursor).toEqual({ createdAt: rows[1]?.created_at, id: rows[1]?.id });
  });

  it('더 없으면 커서가 없다', () => {
    const page = buildPage([row(1), row(2)], 2);
    expect(page?.items).toHaveLength(2);
    expect(page?.nextCursor).toBeNull();
    expect(buildPage([], 20)).toEqual({ items: [], nextCursor: null });
  });

  it('created_at 문자열을 그대로 보존한다(마이크로초 정밀도)', () => {
    const page = buildPage([row(1), row(2)], 1);
    expect(page?.nextCursor?.createdAt).toBe('2026-09-21T00:00:58.000001+00:00');
  });

  it('형식이 어긋난 행이 있으면 빈 목록이 아니라 실패(null)다', () => {
    expect(buildPage([row(1), row(2, { status: 'closed' })], 5)).toBeNull();
    expect(buildPage([row(1, { id: 5 })], 5)).toBeNull();
  });
});

describe('행 변환', () => {
  it('toListItem은 빈 지역·종류를 빈 문자열로 둔다', () => {
    expect(toListItem(row(1, { area: null, category: undefined }))).toMatchObject({ area: '', category: '' });
  });

  it('toDetail은 버전·작성자·수정 시각이 없으면 실패다', () => {
    const base = { ...row(1), map_url: null, memo: '', version: 2, created_by: 'u', updated_at: 't' };
    expect(toDetail(base)?.version).toBe(2);
    expect(toDetail({ ...base, version: '2' })).toBeNull();
  });

  it('toReview는 내 후기와 상대 후기를 구분하고 닉네임을 붙인다', () => {
    const reviewRow = { id: 'r', user_id: 'me', rating: 4, comment: '좋아', version: 1, updated_at: 't' };
    const nicknames = new Map<string, string | null>([
      ['me', '에이'],
      ['you', null],
    ]);
    expect(toReview(reviewRow, 'me', nicknames)).toMatchObject({ isMine: true, authorLabel: '에이' });
    expect(toReview({ ...reviewRow, user_id: 'you' }, 'me', nicknames)).toMatchObject({
      isMine: false,
      authorLabel: '상대방',
    });
    expect(toReview({ ...reviewRow, rating: '4' }, 'me', nicknames)).toBeNull();
  });

  it('sortReviews는 내 후기를 먼저 둔다', () => {
    const nicknames = new Map<string, string | null>();
    const other = toReview({ id: 'a', user_id: 'you', rating: 3, comment: '', version: 1, updated_at: 't' }, 'me', nicknames);
    const mine = toReview({ id: 'b', user_id: 'me', rating: 5, comment: '', version: 1, updated_at: 't' }, 'me', nicknames);
    expect(sortReviews([other!, mine!]).map((review) => review.id)).toEqual(['b', 'a']);
  });
});
