import { describe, expect, it } from 'vitest';

import {
  buildMemoriesHref,
  collectMonthOptions,
  collectTagOptions,
  filterMemories,
  hasActiveFilter,
  parseMemoryFilters,
  selectMemories,
  sortMemoriesLatestFirst,
} from '@/features/memories/filters';
import type { DemoMemory } from '@/lib/demo/types';

function memory(id: string, memoryDate: string, tags: string[] = []): DemoMemory {
  return {
    id,
    title: id,
    body: '',
    memoryDate,
    location: null,
    tags,
    isPinned: false,
    photos: [],
    authorName: '나',
  };
}

const memories: DemoMemory[] = [
  memory('a', '2026-09-12', ['산책', '노을']),
  memory('b', '2026-08-30', ['카페']),
  memory('c', '2026-09-12', ['카페', '산책']),
  memory('d', '2026-04-11', ['산책']),
];

describe('parseMemoryFilters', () => {
  it('월과 태그를 읽는다', () => {
    expect(parseMemoryFilters({ month: '2026-09', tag: '산책' })).toEqual({
      month: '2026-09',
      tag: '산책',
    });
  });

  it('값이 없으면 null이다', () => {
    expect(parseMemoryFilters({})).toEqual({ month: null, tag: null });
    expect(parseMemoryFilters({ month: '', tag: '   ' })).toEqual({ month: null, tag: null });
  });

  it('형식이 잘못된 월은 무시한다', () => {
    expect(parseMemoryFilters({ month: '2026-13' }).month).toBeNull();
    expect(parseMemoryFilters({ month: '202609' }).month).toBeNull();
    expect(parseMemoryFilters({ month: 'javascript:alert(1)' }).month).toBeNull();
  });

  it('같은 이름이 여러 번 오면 첫 값만 쓴다', () => {
    expect(parseMemoryFilters({ month: ['2026-09', '2026-08'] }).month).toBe('2026-09');
  });

  it('hasActiveFilter는 조건이 하나라도 있으면 참이다', () => {
    expect(hasActiveFilter({ month: null, tag: null })).toBe(false);
    expect(hasActiveFilter({ month: '2026-09', tag: null })).toBe(true);
    expect(hasActiveFilter({ month: null, tag: '산책' })).toBe(true);
  });
});

describe('buildMemoriesHref', () => {
  it('조건이 없으면 기본 주소다', () => {
    expect(buildMemoriesHref({ month: null, tag: null })).toBe('/memories');
  });

  it('조건을 검색 매개변수로 붙인다', () => {
    expect(buildMemoriesHref({ month: '2026-09', tag: null })).toBe('/memories?month=2026-09');
    expect(buildMemoriesHref({ month: '2026-09', tag: '산책' })).toBe(
      '/memories?month=2026-09&tag=%EC%82%B0%EC%B1%85',
    );
  });

  it('만든 주소를 다시 읽으면 같은 조건이 나온다', () => {
    const filters = { month: '2026-09', tag: '노을' };
    const url = new URL(buildMemoriesHref(filters), 'http://127.0.0.1:3001');
    expect(
      parseMemoryFilters({
        month: url.searchParams.get('month'),
        tag: url.searchParams.get('tag'),
      }),
    ).toEqual(filters);
  });
});

describe('정렬과 필터', () => {
  it('날짜 내림차순, 같은 날짜면 id 내림차순으로 정렬한다', () => {
    expect(sortMemoriesLatestFirst(memories).map((item) => item.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const input = [...memories];
    sortMemoriesLatestFirst(input);
    expect(input.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('월로 추린다', () => {
    expect(filterMemories(memories, { month: '2026-09', tag: null }).map((m) => m.id)).toEqual([
      'a',
      'c',
    ]);
  });

  it('태그로 추린다', () => {
    expect(filterMemories(memories, { month: null, tag: '카페' }).map((m) => m.id)).toEqual([
      'b',
      'c',
    ]);
  });

  it('월과 태그를 함께 적용한다', () => {
    expect(selectMemories(memories, { month: '2026-09', tag: '카페' }).map((m) => m.id)).toEqual([
      'c',
    ]);
  });

  it('맞는 기록이 없으면 빈 배열이다', () => {
    expect(selectMemories(memories, { month: '2026-01', tag: null })).toEqual([]);
    expect(selectMemories(memories, { month: null, tag: '없는태그' })).toEqual([]);
  });
});

describe('필터 선택지', () => {
  it('기록이 있는 월만 최신순으로 모은다', () => {
    expect(collectMonthOptions(memories)).toEqual(['2026-09', '2026-08', '2026-04']);
  });

  it('태그는 많이 쓴 순, 같으면 가나다순이다', () => {
    expect(collectTagOptions(memories)).toEqual(['산책', '카페', '노을']);
  });

  it('기록이 없으면 선택지도 없다', () => {
    expect(collectMonthOptions([])).toEqual([]);
    expect(collectTagOptions([])).toEqual([]);
  });
});
