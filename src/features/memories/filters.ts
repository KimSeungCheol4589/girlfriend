import { compareCalendarDates, isMonthKey, monthKey } from '@/lib/dates';
import type { DemoMemory } from '@/lib/demo/types';

/**
 * 추억 목록 필터. DESIGN.md 3에 따라 URL 검색 매개변수에 담아 뒤로 가기에도 유지한다.
 * 알 수 없는 값은 오류 대신 '필터 없음'으로 떨어뜨려 목록이 비어 보이지 않게 한다.
 */
export type MemoryFilters = {
  month: string | null;
  tag: string | null;
};

export const EMPTY_MEMORY_FILTERS: MemoryFilters = { month: null, tag: null };

export type RawSearchParams = {
  month?: string | string[] | null;
  tag?: string | string[] | null;
};

function firstValue(value: string | string[] | null | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function parseMemoryFilters(params: RawSearchParams): MemoryFilters {
  const rawMonth = firstValue(params.month)?.trim() ?? '';
  const rawTag = firstValue(params.tag)?.trim() ?? '';

  return {
    month: isMonthKey(rawMonth) ? rawMonth : null,
    tag: rawTag.length > 0 ? rawTag : null,
  };
}

export function hasActiveFilter(filters: MemoryFilters): boolean {
  return filters.month !== null || filters.tag !== null;
}

/** 필터 상태를 `/memories?...` 링크로 만든다. 값이 없으면 매개변수를 넣지 않는다. */
export function buildMemoriesHref(filters: MemoryFilters): string {
  const search = new URLSearchParams();
  if (filters.month) search.set('month', filters.month);
  if (filters.tag) search.set('tag', filters.tag);
  const query = search.toString();
  return query.length > 0 ? `/memories?${query}` : '/memories';
}

/** DESIGN.md 3: `memory_date DESC, id DESC` 정렬. */
export function sortMemoriesLatestFirst(memories: readonly DemoMemory[]): DemoMemory[] {
  return [...memories].sort((a, b) => {
    const byDate = compareCalendarDates(b.memoryDate, a.memoryDate);
    if (byDate !== 0) return byDate;
    return b.id.localeCompare(a.id);
  });
}

export function filterMemories(
  memories: readonly DemoMemory[],
  filters: MemoryFilters,
): DemoMemory[] {
  return memories.filter((memory) => {
    if (filters.month && monthKey(memory.memoryDate) !== filters.month) return false;
    if (filters.tag && !memory.tags.includes(filters.tag)) return false;
    return true;
  });
}

export function selectMemories(
  memories: readonly DemoMemory[],
  filters: MemoryFilters,
): DemoMemory[] {
  return sortMemoriesLatestFirst(filterMemories(memories, filters));
}

/** 필터 선택지. 기록이 있는 월·태그만 보여준다. */
export function collectMonthOptions(memories: readonly DemoMemory[]): string[] {
  const months = new Set(memories.map((memory) => monthKey(memory.memoryDate)));
  return [...months].sort((a, b) => b.localeCompare(a));
}

export function collectTagOptions(memories: readonly DemoMemory[]): string[] {
  const counts = new Map<string, number>();
  for (const memory of memories) {
    for (const tag of memory.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1] !== 0 ? b[1] - a[1] : a[0].localeCompare(b[0], 'ko-KR')))
    .map(([tag]) => tag);
}
