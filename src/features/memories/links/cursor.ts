import { isUuid } from '../live/ids';

import { LINK_CURSOR_MAX_LENGTH } from './constants';

/**
 * 연결 후보 목록의 커서 — 순수 함수.
 *
 * 형식: `<정렬 기준>|<id>`. 일정은 `starts_at DESC, id DESC`, 위시는 `created_at DESC, id DESC`로
 * 정렬한다(각 기능의 기존 인덱스와 같은 방향이다).
 *
 * 형식이 어긋난 커서는 **첫 페이지로 되돌리지 않는다.** 되돌리면 이미 본 항목이 다시 나와
 * 같은 계획을 두 번 고르게 된다. 대신 빈 결과로 끝낸다(추억 목록의 커서 규칙과 같다).
 *
 * 정렬 기준 값은 **timestamptz 문자열만** 허용한다(wishes/restaurants/memories와 같은 방식).
 * 형식을 좁게 검사한 값만 PostgREST 필터에 넣고, 타임스탬프는 `+`·`:`를 포함하므로 따옴표로 감싼다.
 */

export type LinkCursor = { value: string; id: string };

/** `2026-09-26T12:34:56.789+09:00` 형태. wishes/filters.ts의 검사와 같은 형식이다. */
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

export function isLinkCursor(value: unknown): value is LinkCursor {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.value === 'string' &&
    TIMESTAMP_PATTERN.test(candidate.value) &&
    isUuid(candidate.id)
  );
}

export function encodeLinkCursor(cursor: LinkCursor): string {
  if (!isLinkCursor(cursor)) throw new RangeError('잘못된 커서');
  return `${cursor.value}|${cursor.id}`;
}

export function decodeLinkCursor(raw: string | null): LinkCursor | null {
  if (raw === null || raw === '') return null;
  // 길이를 먼저 막는다. 긴 문자열을 정규식에 통과시키지 않는다.
  if (raw.length > LINK_CURSOR_MAX_LENGTH) return null;
  // 정렬 기준 값(timestamptz 문자열)에 `|`가 들어갈 일은 없지만, 마지막 구분자를 기준으로 나눠
  // ID 쪽을 정확히 집는다.
  const separator = raw.lastIndexOf('|');
  if (separator <= 0) return null;
  const cursor = { value: raw.slice(0, separator), id: raw.slice(separator + 1) };
  // 형식을 통과하지 못한 커서는 되살리지 않는다(주입 시도·잘린 값 모두 여기서 끝난다).
  if (!isLinkCursor(cursor)) return null;
  return { value: cursor.value, id: cursor.id.toLowerCase() };
}

/**
 * PostgREST `or` 필터: `(기준 < v) 또는 (기준 = v 이고 id < i)`.
 * 값은 위 형식 검사를 통과한 것만 들어오며, 타임스탬프는 따옴표로 감싼다(`+`, `:` 포함).
 */
export function linkCursorFilter(column: string, cursor: LinkCursor): string {
  if (!isLinkCursor(cursor)) throw new RangeError('잘못된 커서');
  const at = `"${cursor.value}"`;
  return `${column}.lt.${at},and(${column}.eq.${at},id.lt.${cursor.id.toLowerCase()})`;
}
