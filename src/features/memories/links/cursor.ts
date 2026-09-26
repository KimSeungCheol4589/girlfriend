import { isUuid } from '../live/ids';

/**
 * 연결 후보 목록의 커서 — 순수 함수.
 *
 * 형식: `<정렬 기준>|<id>`. 일정은 `starts_at DESC, id DESC`, 위시는 `created_at DESC, id DESC`로
 * 정렬한다(각 기능의 기존 인덱스와 같은 방향이다).
 *
 * 형식이 어긋난 커서는 **첫 페이지로 되돌리지 않는다.** 되돌리면 이미 본 항목이 다시 나와
 * 같은 계획을 두 번 고르게 된다. 대신 빈 결과로 끝낸다(추억 목록의 커서 규칙과 같다).
 */

export type LinkCursor = { value: string; id: string };

export function encodeLinkCursor(cursor: LinkCursor): string {
  return `${cursor.value}|${cursor.id}`;
}

export function decodeLinkCursor(raw: string | null): LinkCursor | null {
  if (raw === null || raw === '') return null;
  // 정렬 기준 값(timestamptz 문자열)에 `|`가 들어갈 일은 없지만, 마지막 구분자를 기준으로 나눠
  // ID 쪽을 정확히 집는다.
  const separator = raw.lastIndexOf('|');
  if (separator <= 0) return null;
  const value = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (value.length === 0 || !isUuid(id)) return null;
  return { value, id };
}

/** PostgREST `or` 필터: `(기준 < v) 또는 (기준 = v 이고 id < i)`. */
export function linkCursorFilter(column: string, cursor: LinkCursor): string {
  return `${column}.lt.${cursor.value},and(${column}.eq.${cursor.value},id.lt.${cursor.id})`;
}
