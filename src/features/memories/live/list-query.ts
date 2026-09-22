import { MEMORY_LIMITS } from '@/lib/contracts';
import { isCalendarDate, isMonthKey } from '@/lib/dates';

import { isUuid } from './ids';

/**
 * 추억 목록 조회 조건.
 *
 * DESIGN.md 3: `memory_date DESC, id DESC`로 정렬하고 그 쌍을 커서로 쓴다.
 * 필터(월·태그)는 URL에 두고, 필터가 바뀌면 커서를 초기화한다(커서는 URL에 두지 않는다).
 *
 * 이 파일은 순수 함수만 담는다. PostgREST 필터 문자열은 검증한 값으로만 만든다.
 */

export type MemoryCursor = { memoryDate: string; id: string };

const CURSOR_SEPARATOR = '_';

/** 커서는 `YYYY-MM-DD_uuid` 문자열이다. 서버가 만들고 서버가 다시 검증한다. */
export function encodeCursor(cursor: MemoryCursor): string {
  return `${cursor.memoryDate}${CURSOR_SEPARATOR}${cursor.id}`;
}

export function parseCursor(raw: unknown): MemoryCursor | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const index = raw.indexOf(CURSOR_SEPARATOR);
  if (index <= 0) return null;
  const memoryDate = raw.slice(0, index);
  const id = raw.slice(index + 1);
  if (!isCalendarDate(memoryDate) || !isUuid(id)) return null;
  return { memoryDate, id: id.toLowerCase() };
}

/**
 * 커서 다음 행 조건. `(memory_date, id) < (cursor.date, cursor.id)`와 같다.
 * 값은 `parseCursor`를 통과한 날짜·UUID뿐이라 PostgREST 구문을 깨뜨릴 문자가 없다.
 */
export function cursorOrFilter(cursor: MemoryCursor): string {
  const { memoryDate, id } = cursor;
  if (!isCalendarDate(memoryDate) || !isUuid(id)) {
    throw new RangeError('잘못된 커서');
  }
  return `memory_date.lt.${memoryDate},and(memory_date.eq.${memoryDate},id.lt.${id})`;
}

/** `YYYY-MM` → 그 달 1일(포함)과 다음 달 1일(제외). */
export function monthRange(month: string): { from: string; to: string } | null {
  if (!isMonthKey(month)) return null;
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    from: `${year}-${pad(monthNumber)}-01`,
    to: `${nextYear}-${pad(nextMonth)}-01`,
  };
}

/**
 * 태그 필터 값.
 * 저장 가능한 태그(1~20자)보다 긴 값은 어떤 기록과도 맞지 않는다. 그 사실을 그대로 보여 준다
 * (필터를 조용히 지워 전체 목록을 보여 주면 사용자가 결과를 오해한다).
 */
export type TagFilter = { kind: 'none' } | { kind: 'tag'; value: string } | { kind: 'impossible' };

export function toTagFilter(tag: string | null): TagFilter {
  if (tag === null) return { kind: 'none' };
  const value = tag.trim();
  if (value.length === 0) return { kind: 'none' };
  if (value.length > MEMORY_LIMITS.tagMax) return { kind: 'impossible' };
  return { kind: 'tag', value };
}

/**
 * PostgreSQL 배열 리터럴. 태그에는 쉼표·따옴표·중괄호가 들어갈 수 있으므로
 * 모든 원소를 큰따옴표로 감싸고 `\`와 `"`를 이스케이프한다.
 * (supabase-js의 `contains(col, array)`는 원소를 따옴표 없이 이어 붙인다.)
 */
export function toPgArrayLiteral(values: readonly string[]): string {
  const items = values.map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `{${items.join(',')}}`;
}

/** 한 행 더 읽어 다음 페이지가 있는지 판단한다. */
export function splitPage<T extends { memoryDate: string; id: string }>(
  rows: readonly T[],
  pageSize: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, pageSize);
  const last = items[items.length - 1];
  const hasMore = rows.length > pageSize && last !== undefined;
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ memoryDate: last.memoryDate, id: last.id }) : null,
  };
}

/** 필터 선택지. 기록이 있는 월(최신순)과 태그(많이 쓴 순)만 보여 준다. */
export function collectLiveFilterOptions(
  rows: readonly { memoryDate: string; tags: readonly string[] }[],
): { months: string[]; tags: string[] } {
  const months = new Set<string>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (isCalendarDate(row.memoryDate)) months.add(row.memoryDate.slice(0, 7));
    for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return {
    months: [...months].sort((a, b) => b.localeCompare(a)),
    tags: [...counts.entries()]
      .sort((a, b) => (b[1] - a[1] !== 0 ? b[1] - a[1] : a[0].localeCompare(b[0], 'ko-KR')))
      .map(([tag]) => tag),
  };
}
