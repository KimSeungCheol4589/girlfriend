import { describe, expect, it } from 'vitest';

import {
  buildWishesHref,
  cursorOrFilter,
  EMPTY_FILTERS,
  filtersKey,
  hasActiveFilter,
  isWishCursor,
  parseWishFilters,
  toTitleSearchPattern,
} from '@/features/wishes/filters';
import { WISH_LIMITS } from '@/features/wishes/constants';

/**
 * 목록 필터·커서 단위 테스트.
 *
 * DESIGN 3: 필터는 URL에 담아 뒤로 가기에도 유지한다.
 * 정렬·커서는 `created_at DESC, id DESC`이고, 커서 값은 DB가 준 문자열 그대로 쓴다.
 */

const ID = '3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69';

describe('parseWishFilters', () => {
  it('알 수 없는 값은 버린다', () => {
    expect(parseWishFilters({ status: 'nope', category: 'restaurant', q: '' })).toEqual(EMPTY_FILTERS);
    expect(parseWishFilters({})).toEqual(EMPTY_FILTERS);
  });

  it('허용된 상태·분류만 받아들이고 검색어는 다듬는다', () => {
    expect(parseWishFilters({ status: 'planned', category: 'trip', q: '  제주  ' })).toEqual({
      status: 'planned',
      category: 'trip',
      q: '제주',
    });
  });

  it('배열로 들어온 값은 첫 번째만 쓴다', () => {
    expect(parseWishFilters({ status: ['done', 'wish'], q: ['a', 'b'] })).toMatchObject({
      status: 'done',
      q: 'a',
    });
  });

  it('검색어를 코드 포인트 기준으로 자른다(서로게이트 쌍을 쪼개지 않는다)', () => {
    const long = '🎈'.repeat(WISH_LIMITS.searchMax + 10);
    const parsed = parseWishFilters({ q: long });
    expect(Array.from(parsed.q)).toHaveLength(WISH_LIMITS.searchMax);
    expect(parsed.q.endsWith('🎈')).toBe(true);
  });
});

describe('hasActiveFilter', () => {
  it('필터가 하나라도 있으면 true', () => {
    expect(hasActiveFilter(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilter({ ...EMPTY_FILTERS, status: 'wish' })).toBe(true);
    expect(hasActiveFilter({ ...EMPTY_FILTERS, category: 'place' })).toBe(true);
    expect(hasActiveFilter({ ...EMPTY_FILTERS, q: 'a' })).toBe(true);
  });
});

describe('buildWishesHref', () => {
  it('필터가 없으면 기본 주소다', () => {
    expect(buildWishesHref(EMPTY_FILTERS)).toBe('/wishes');
  });

  it('같은 필터는 항상 같은 주소가 된다(순서 고정)', () => {
    const href = buildWishesHref({ status: 'done', category: 'trip', q: '제주 여행' });
    expect(href).toBe('/wishes?status=done&category=trip&q=%EC%A0%9C%EC%A3%BC+%EC%97%AC%ED%96%89');
    expect(filtersKey({ status: 'done', category: 'trip', q: '제주 여행' })).toBe(href);
  });

  it('주소를 다시 읽으면 같은 필터가 된다', () => {
    const filters = { status: 'planned', category: 'shopping', q: '선물' } as const;
    const url = new URL(buildWishesHref(filters), 'http://test.invalid');
    expect(parseWishFilters(Object.fromEntries(url.searchParams))).toEqual(filters);
  });
});

describe('toTitleSearchPattern', () => {
  it('LIKE 특수문자를 글자 그대로 찾는다', () => {
    expect(toTitleSearchPattern('100%')).toBe('%100\\%%');
    expect(toTitleSearchPattern('a_b')).toBe('%a\\_b%');
    expect(toTitleSearchPattern('a\\b')).toBe('%a\\\\b%');
  });

  it('별표는 한 글자 와일드카드로 바꾼다(PostgREST가 %로 바꾸는 것을 막는다)', () => {
    expect(toTitleSearchPattern('a*b')).toBe('%a_b%');
  });
});

describe('isWishCursor', () => {
  it('타임스탬프와 UUID 형식만 통과시킨다', () => {
    expect(isWishCursor({ createdAt: '2026-09-23T01:02:03.123456+00:00', id: ID })).toBe(true);
    expect(isWishCursor({ createdAt: '2026-09-23T01:02:03Z', id: ID })).toBe(true);
    expect(isWishCursor({ createdAt: 'yesterday', id: ID })).toBe(false);
    expect(isWishCursor({ createdAt: '2026-09-23T01:02:03Z', id: 'nope' })).toBe(false);
    expect(isWishCursor(null)).toBe(false);
    expect(isWishCursor('cursor')).toBe(false);
  });
});

describe('cursorOrFilter', () => {
  it('(created_at, id) 쌍 비교를 PostgREST or 필터로 만든다', () => {
    const cursor = { createdAt: '2026-09-23T01:02:03.123456+00:00', id: ID };
    expect(cursorOrFilter(cursor)).toBe(
      'created_at.lt."2026-09-23T01:02:03.123456+00:00",and(created_at.eq."2026-09-23T01:02:03.123456+00:00",id.lt.3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69)',
    );
  });

  it('검증을 통과하지 않은 커서는 쓰지 않는다', () => {
    expect(() => cursorOrFilter({ createdAt: 'x', id: ID })).toThrow(RangeError);
  });
});
