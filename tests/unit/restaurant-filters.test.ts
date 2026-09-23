import { describe, expect, it } from 'vitest';

import {
  buildRestaurantsHref,
  cursorOrFilter,
  EMPTY_FILTERS,
  hasActiveFilter,
  isRestaurantCursor,
  parseRestaurantFilters,
  toNameSearchPattern,
} from '@/features/restaurants/filters';

describe('parseRestaurantFilters', () => {
  it('알려진 상태만 받고 나머지는 전체로 본다', () => {
    expect(parseRestaurantFilters({ status: 'visited' }).status).toBe('visited');
    expect(parseRestaurantFilters({ status: 'wishlist' }).status).toBe('wishlist');
    expect(parseRestaurantFilters({ status: 'deleted' }).status).toBeNull();
    expect(parseRestaurantFilters({ status: ['visited', 'wishlist'] }).status).toBe('visited');
    expect(parseRestaurantFilters({})).toEqual(EMPTY_FILTERS);
  });

  it('공백을 다듬고 길이를 코드 포인트 기준으로 자른다', () => {
    const filters = parseRestaurantFilters({
      q: `  ${'🍜'.repeat(150)}  `,
      area: ` ${'가'.repeat(60)} `,
      category: ' 한식 ',
    });
    expect(Array.from(filters.q)).toHaveLength(100);
    expect(filters.q.endsWith('\uD83C')).toBe(false);
    expect(filters.area).toHaveLength(50);
    expect(filters.category).toBe('한식');
  });

  it('hasActiveFilter', () => {
    expect(hasActiveFilter(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilter({ ...EMPTY_FILTERS, q: '파스타' })).toBe(true);
    expect(hasActiveFilter({ ...EMPTY_FILTERS, status: 'visited' })).toBe(true);
  });
});

describe('buildRestaurantsHref', () => {
  it('필터 순서를 고정하고 빈 값은 넣지 않는다(커서는 URL에 넣지 않는다)', () => {
    expect(buildRestaurantsHref(EMPTY_FILTERS)).toBe('/restaurants');
    expect(
      buildRestaurantsHref({ status: 'visited', q: '파스타 집', area: '성수', category: '양식' }),
    ).toBe('/restaurants?status=visited&q=%ED%8C%8C%EC%8A%A4%ED%83%80+%EC%A7%91&area=%EC%84%B1%EC%88%98&category=%EC%96%91%EC%8B%9D');
  });

  it('URL → 필터 → URL 왕복이 같다', () => {
    const href = buildRestaurantsHref({ status: 'wishlist', q: '50% & 할인', area: 'a=b', category: '' });
    const params = Object.fromEntries(new URL(href, 'http://x.invalid').searchParams);
    expect(buildRestaurantsHref(parseRestaurantFilters(params))).toBe(href);
  });
});

describe('toNameSearchPattern', () => {
  it('LIKE 특수 문자를 글자로 찾게 이스케이프하고 양쪽에 %를 붙인다', () => {
    expect(toNameSearchPattern('파스타')).toBe('%파스타%');
    expect(toNameSearchPattern('100%')).toBe('%100\\%%');
    expect(toNameSearchPattern('a_b')).toBe('%a\\_b%');
    expect(toNameSearchPattern('a\\b')).toBe('%a\\\\b%');
  });

  it('PostgREST가 %로 바꾸는 *는 한 글자 와일드카드로 바꾼다', () => {
    expect(toNameSearchPattern('별*집')).toBe('%별_집%');
  });
});

describe('커서', () => {
  const cursor = { createdAt: '2026-09-21T01:02:03.123456+00:00', id: '3F1C2B1A-8D4E-4C3B-9A2F-1E2D3C4B5A69' };

  it('DB 타임스탬프와 UUID 형식만 받는다', () => {
    expect(isRestaurantCursor(cursor)).toBe(true);
    expect(isRestaurantCursor({ ...cursor, createdAt: '2026-09-21T01:02:03Z' })).toBe(true);
    expect(isRestaurantCursor({ ...cursor, createdAt: '2026-09-21 01:02:03.1+00' })).toBe(true);
    expect(isRestaurantCursor({ ...cursor, createdAt: 'yesterday' })).toBe(false);
    expect(isRestaurantCursor({ ...cursor, id: 'not-a-uuid' })).toBe(false);
    expect(isRestaurantCursor(null)).toBe(false);
    expect(isRestaurantCursor('x')).toBe(false);
  });

  it('필터 주입 문자가 섞인 값은 커서로 받지 않는다', () => {
    expect(isRestaurantCursor({ ...cursor, createdAt: '2026-09-21T01:02:03Z),id.gt.(0' })).toBe(false);
    expect(isRestaurantCursor({ ...cursor, id: `${cursor.id},name.eq.x` })).toBe(false);
    expect(() => cursorOrFilter({ createdAt: 'bad', id: cursor.id })).toThrow();
  });

  it('(created_at, id) 쌍보다 앞선 행을 고르는 or 필터를 만든다', () => {
    expect(cursorOrFilter(cursor)).toBe(
      'created_at.lt."2026-09-21T01:02:03.123456+00:00",and(created_at.eq."2026-09-21T01:02:03.123456+00:00",id.lt.3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69)',
    );
  });
});
