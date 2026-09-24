import { describe, expect, it } from 'vitest';

import {
  addDays,
  currentMonthKey,
  datesBetween,
  firstDayOfMonth,
  firstDayOfNextMonth,
  monthGrid,
  parseMonthKey,
  shiftMonth,
} from '@/features/calendar/month';

describe('parseMonthKey', () => {
  it('YYYY-MM만 받고 나머지는 기본값이다', () => {
    expect(parseMonthKey('2026-11', '2026-09')).toBe('2026-11');
    expect(parseMonthKey('2026-13', '2026-09')).toBe('2026-09');
    expect(parseMonthKey('2026-1', '2026-09')).toBe('2026-09');
    expect(parseMonthKey('', '2026-09')).toBe('2026-09');
    expect(parseMonthKey(undefined, '2026-09')).toBe('2026-09');
    expect(parseMonthKey(['2026-11'], '2026-09')).toBe('2026-09');
  });
});

describe('currentMonthKey', () => {
  it('한국 날짜의 달을 쓴다', () => {
    expect(currentMonthKey('2026-09-23')).toBe('2026-09');
  });
});

describe('shiftMonth', () => {
  it('앞뒤로 옮긴다', () => {
    expect(shiftMonth('2026-11', 1)).toBe('2026-12');
    expect(shiftMonth('2026-11', -1)).toBe('2026-10');
  });

  it('해를 넘긴다', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-01', -13)).toBe('2024-12');
    expect(shiftMonth('2026-12', 13)).toBe('2028-01');
  });
});

describe('월 경계', () => {
  it('첫날과 다음 달 첫날', () => {
    expect(firstDayOfMonth('2026-02')).toBe('2026-02-01');
    expect(firstDayOfNextMonth('2026-02')).toBe('2026-03-01');
    expect(firstDayOfNextMonth('2026-12')).toBe('2027-01-01');
  });
});

describe('addDays', () => {
  it('달·해를 넘어간다', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    // 2028은 윤년이다.
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('달력 날짜가 아니면 던진다', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });
});

describe('datesBetween', () => {
  it('양끝을 포함한다', () => {
    expect(datesBetween('2026-10-03', '2026-10-05')).toEqual([
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]);
  });

  it('하루면 하루만', () => {
    expect(datesBetween('2026-10-03', '2026-10-03')).toEqual(['2026-10-03']);
  });

  it('역순이면 비어 있다', () => {
    expect(datesBetween('2026-10-05', '2026-10-03')).toEqual([]);
  });

  it('상한을 넘기지 않는다', () => {
    expect(datesBetween('2026-01-01', '2030-01-01', 5)).toHaveLength(5);
  });
});

describe('monthGrid', () => {
  it('항상 7의 배수이고 일요일에서 시작한다', () => {
    for (const key of ['2026-02', '2026-11', '2027-08', '2028-02']) {
      const weeks = monthGrid(key);
      expect(weeks.every((week) => week.length === 7)).toBe(true);
      expect(weeks[0]?.[0]?.weekday).toBe(0);
    }
  });

  it('이번 달의 모든 날을 정확히 한 번 담는다', () => {
    const weeks = monthGrid('2026-11');
    const inMonth = weeks.flat().filter((day) => day.inMonth);
    expect(inMonth).toHaveLength(30);
    expect(new Set(inMonth.map((day) => day.date)).size).toBe(30);
    expect(inMonth[0]?.date).toBe('2026-11-01');
    expect(inMonth[29]?.date).toBe('2026-11-30');
  });

  it('앞뒤 칸은 이 달이 아니라고 표시한다', () => {
    // 2026-11-01은 일요일이라 앞 칸이 없다. 2026-12-01은 화요일이라 앞에 두 칸이 붙는다.
    expect(monthGrid('2026-11')[0]?.[0]?.date).toBe('2026-11-01');
    const december = monthGrid('2026-12');
    expect(december[0]?.[0]).toMatchObject({ date: '2026-11-29', inMonth: false });
    expect(december[0]?.[2]).toMatchObject({ date: '2026-12-01', inMonth: true });
  });

  it('여섯 주가 필요한 달도 담는다', () => {
    // 2026-08-01은 토요일이고 31일이라 6주가 필요하다.
    expect(monthGrid('2026-08')).toHaveLength(6);
  });
});
