import { describe, expect, it } from 'vitest';

import { LINK_CURSOR_MAX_LENGTH } from '@/features/memories/links/constants';
import {
  decodeLinkCursor,
  encodeLinkCursor,
  isLinkCursor,
  linkCursorFilter,
} from '@/features/memories/links/cursor';

/**
 * 연결 후보 커서 계약(DATE-001).
 *
 * 지키려는 것
 *   1. 정렬 기준 값은 **timestamptz 문자열만** 허용한다(wishes/restaurants/memories와 같은 방식).
 *   2. PostgREST `or` 필터의 타임스탬프는 따옴표로 감싼다. `+`·`:`가 들어가기 때문이다.
 *   3. 형식이 어긋난 커서는 첫 페이지로 되돌리지 않고 **빈 결과**로 끝낸다(중복 표시 방지).
 *   4. 검증을 통과하지 못한 값은 필터 문자열로 만들지 않는다(주입 차단).
 */

const AT = '2026-09-26T12:34:56.789+09:00';
const ID = '11111111-2222-4333-8444-555555555555';

describe('정상 인코딩·디코딩', () => {
  it('왕복해도 같은 값이다', () => {
    const encoded = encodeLinkCursor({ value: AT, id: ID });
    expect(encoded).toBe(`${AT}|${ID}`);
    expect(decodeLinkCursor(encoded)).toEqual({ value: AT, id: ID });
  });

  it('여러 timestamptz 표기를 받아들인다', () => {
    for (const value of [
      '2026-09-26T12:34:56Z',
      '2026-09-26 12:34:56+09',
      '2026-09-26T12:34:56.1-03:30',
      '2026-09-26T12:34:56.123456+0900',
    ]) {
      expect(isLinkCursor({ value, id: ID }), value).toBe(true);
      expect(decodeLinkCursor(`${value}|${ID}`), value).toEqual({ value, id: ID });
    }
  });

  it('대문자 UUID는 소문자로 맞춘다(DB 표기와 같게)', () => {
    expect(decodeLinkCursor(`${AT}|${ID.toUpperCase()}`)).toEqual({ value: AT, id: ID });
  });
});

describe('필터 문자열', () => {
  it('타임스탬프를 따옴표로 감싼다', () => {
    const filter = linkCursorFilter('starts_at', { value: AT, id: ID });
    expect(filter).toBe(`starts_at.lt."${AT}",and(starts_at.eq."${AT}",id.lt.${ID})`);
    // 따옴표가 없으면 `+09:00`의 `+`·`:`가 PostgREST 구문에서 잘못 읽힌다.
    expect(filter).toContain(`"${AT}"`);
  });

  it('검증을 통과하지 못한 값으로는 필터를 만들지 않는다', () => {
    expect(() => linkCursorFilter('created_at', { value: 'x', id: ID })).toThrow(RangeError);
    expect(() => linkCursorFilter('created_at', { value: AT, id: 'not-uuid' })).toThrow(RangeError);
    expect(() => encodeLinkCursor({ value: 'x', id: ID })).toThrow(RangeError);
  });
});

describe('형식 위반은 빈 결과로 끝낸다(null)', () => {
  it('빈 값·구분자 없음', () => {
    expect(decodeLinkCursor(null)).toBeNull();
    expect(decodeLinkCursor('')).toBeNull();
    expect(decodeLinkCursor('구분자없음')).toBeNull();
    expect(decodeLinkCursor(`|${ID}`)).toBeNull();
    expect(decodeLinkCursor(`${AT}|`)).toBeNull();
  });

  it('정렬 기준이 timestamptz 형식이 아니면 거부한다', () => {
    expect(decodeLinkCursor(`2026-09-26|${ID}`), '날짜만 있는 값').toBeNull();
    expect(decodeLinkCursor(`not-a-time|${ID}`)).toBeNull();
    expect(decodeLinkCursor(`2026-09-26T12:34|${ID}`), '초가 없는 값').toBeNull();
    expect(decodeLinkCursor(`2026-09-26T12:34:56|${ID}`), '시간대가 없는 값').toBeNull();
  });

  it('검사하는 것은 형식이지 달력 유효성이 아니다(기존 wishes 커서와 같은 범위)', () => {
    // 자리수·구분자만 본다. 실제로 없는 시각은 DB가 거부한다.
    // 이 커서는 서버가 만든 값만 되돌려받는 자리라 형식 검사로 충분하다.
    expect(decodeLinkCursor(`2026-13-99T25:61:61Z|${ID}`)).not.toBeNull();
  });

  it('id가 UUID가 아니면 거부한다', () => {
    expect(decodeLinkCursor(`${AT}|123`)).toBeNull();
    expect(decodeLinkCursor(`${AT}|${ID}x`)).toBeNull();
  });

  it('상한보다 긴 커서는 정규식에 넣지 않고 바로 거부한다', () => {
    const long = `${AT}|${ID}${'0'.repeat(LINK_CURSOR_MAX_LENGTH)}`;
    expect(long.length).toBeGreaterThan(LINK_CURSOR_MAX_LENGTH);
    expect(decodeLinkCursor(long)).toBeNull();
  });
});

describe('주입 시도', () => {
  it('PostgREST 구문 문자가 섞인 값은 디코드 단계에서 끝난다', () => {
    for (const raw of [
      `${AT}",id.gt."0000-01-01T00:00:00Z|${ID}`,
      `2026-09-26T12:34:56Z,or(id.gt.0)|${ID}`,
      `*|${ID}`,
      `${AT}|${ID})`,
      `${AT}|${ID},and(id.gt.0)`,
    ]) {
      expect(decodeLinkCursor(raw), raw).toBeNull();
    }
  });

  it('따옴표를 넣어 필터를 끊으려는 값도 거부한다', () => {
    expect(isLinkCursor({ value: `${AT}"`, id: ID })).toBe(false);
    expect(isLinkCursor({ value: `"${AT}"`, id: ID })).toBe(false);
  });
});
