import { describe, expect, it } from 'vitest';

import {
  collectLiveFilterOptions,
  cursorOrFilter,
  encodeCursor,
  monthRange,
  parseCursor,
  splitPage,
  toPgArrayLiteral,
  toTagFilter,
} from '@/features/memories/live/list-query';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

describe('커서', () => {
  it('날짜·ID 쌍을 왕복한다', () => {
    const raw = encodeCursor({ memoryDate: '2026-09-19', id: ID_A });
    expect(parseCursor(raw)).toEqual({ memoryDate: '2026-09-19', id: ID_A });
  });

  it('형식이 틀린 커서는 거부한다', () => {
    for (const raw of [
      '',
      'abc',
      `2026-02-30_${ID_A}`,
      '2026-09-19_not-a-uuid',
      `2026-09-19_${ID_A},id.gt.0`,
      `2026-09-19_${ID_A})`,
      null,
      42,
      `${'9'.repeat(60)}_${ID_A}`,
    ]) {
      expect(parseCursor(raw)).toBeNull();
    }
  });

  it('memory_date DESC, id DESC 다음 행 조건을 만든다', () => {
    expect(cursorOrFilter({ memoryDate: '2026-09-19', id: ID_B })).toBe(
      `memory_date.lt.2026-09-19,and(memory_date.eq.2026-09-19,id.lt.${ID_B})`,
    );
  });

  it('검증하지 않은 값으로는 필터를 만들지 않는다', () => {
    expect(() => cursorOrFilter({ memoryDate: '2026-09-19),or(true', id: ID_A })).toThrow();
  });
});

describe('monthRange', () => {
  it('그 달 1일부터 다음 달 1일 전까지', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-10-01' });
  });

  it('12월은 다음 해 1월로 넘어간다', () => {
    expect(monthRange('2025-12')).toEqual({ from: '2025-12-01', to: '2026-01-01' });
  });

  it('형식이 틀리면 null', () => {
    expect(monthRange('2026-13')).toBeNull();
    expect(monthRange('2026-9')).toBeNull();
  });
});

describe('태그 필터', () => {
  it('없음·정상·불가능을 구분한다', () => {
    expect(toTagFilter(null)).toEqual({ kind: 'none' });
    expect(toTagFilter('  ')).toEqual({ kind: 'none' });
    expect(toTagFilter(' 산책 ')).toEqual({ kind: 'tag', value: '산책' });
    // 저장할 수 없는 길이의 태그는 어떤 기록과도 맞지 않는다(필터를 조용히 지우지 않는다).
    expect(toTagFilter('가'.repeat(21))).toEqual({ kind: 'impossible' });
  });

  it('배열 리터럴은 쉼표·따옴표·중괄호·역슬래시를 이스케이프한다', () => {
    expect(toPgArrayLiteral(['산책'])).toBe('{"산책"}');
    expect(toPgArrayLiteral(['a,b'])).toBe('{"a,b"}');
    expect(toPgArrayLiteral(['say "hi"'])).toBe('{"say \\"hi\\""}');
    expect(toPgArrayLiteral(['{x}'])).toBe('{"{x}"}');
    expect(toPgArrayLiteral(['back\\slash'])).toBe('{"back\\\\slash"}');
  });
});

describe('splitPage', () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(100 - index).padStart(12, '0')}`,
    memoryDate: '2026-09-01',
  }));

  it('한 행 더 읽었으면 다음 커서를 만든다', () => {
    const page = splitPage(rows, 20);
    expect(page.items).toHaveLength(20);
    const last = page.items[19];
    expect(page.nextCursor).toBe(`2026-09-01_${last?.id}`);
  });

  it('페이지 크기 이하이면 마지막 페이지', () => {
    const page = splitPage(rows.slice(0, 20), 20);
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toBeNull();
  });

  it('빈 결과', () => {
    expect(splitPage([], 20)).toEqual({ items: [], nextCursor: null });
  });
});

describe('collectLiveFilterOptions', () => {
  it('월은 최신순, 태그는 많이 쓴 순(같으면 가나다)', () => {
    const options = collectLiveFilterOptions([
      { memoryDate: '2026-08-02', tags: ['카페'] },
      { memoryDate: '2026-09-19', tags: ['산책', '카페'] },
      { memoryDate: '2026-09-01', tags: ['산책'] },
      { memoryDate: '2025-12-31', tags: ['노을'] },
    ]);
    expect(options.months).toEqual(['2026-09', '2026-08', '2025-12']);
    expect(options.tags).toEqual(['산책', '카페', '노을']);
  });
});
