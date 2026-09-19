import { describe, expect, it } from 'vitest';

import {
  compareCalendarDates,
  daysTogether,
  differenceInCalendarDays,
  formatKoreanDate,
  formatKoreanMonth,
  isCalendarDate,
  isMonthKey,
  monthKey,
  parseCalendarDate,
  todayInSeoul,
} from '@/lib/dates';

describe('parseCalendarDate', () => {
  it('정상 날짜를 연·월·일로 나눈다', () => {
    expect(parseCalendarDate('2026-09-19')).toEqual({ year: 2026, month: 9, day: 19 });
  });

  it('존재하지 않는 날짜를 거부한다', () => {
    expect(parseCalendarDate('2026-02-30')).toBeNull();
    expect(parseCalendarDate('2025-02-29')).toBeNull();
    expect(parseCalendarDate('2026-13-01')).toBeNull();
    expect(parseCalendarDate('2026-00-10')).toBeNull();
  });

  it('윤년 2월 29일은 받아들인다', () => {
    expect(parseCalendarDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('형식이 다르면 거부한다', () => {
    expect(parseCalendarDate('2026-9-19')).toBeNull();
    expect(parseCalendarDate('2026/09/19')).toBeNull();
    expect(parseCalendarDate('')).toBeNull();
    expect(parseCalendarDate('2026-09-19T00:00:00Z')).toBeNull();
  });

  it('isCalendarDate는 같은 규칙을 따른다', () => {
    expect(isCalendarDate('2026-09-19')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
  });
});

describe('differenceInCalendarDays', () => {
  it('달력 날짜 기준으로 일 수를 센다', () => {
    expect(differenceInCalendarDays('2026-09-19', '2026-09-20')).toBe(1);
    expect(differenceInCalendarDays('2026-09-20', '2026-09-19')).toBe(-1);
    expect(differenceInCalendarDays('2026-09-19', '2026-09-19')).toBe(0);
  });

  it('월·연 경계를 넘어도 맞는다', () => {
    expect(differenceInCalendarDays('2026-01-31', '2026-02-01')).toBe(1);
    expect(differenceInCalendarDays('2025-12-31', '2026-01-01')).toBe(1);
    expect(differenceInCalendarDays('2024-02-28', '2024-03-01')).toBe(2); // 윤년
    expect(differenceInCalendarDays('2025-02-28', '2025-03-01')).toBe(1);
  });

  it('형식이 잘못되면 예외를 던진다', () => {
    expect(() => differenceInCalendarDays('2026-02-30', '2026-03-01')).toThrow(RangeError);
  });
});

describe('daysTogether', () => {
  it('시작 당일을 1일로 센다', () => {
    expect(daysTogether('2026-09-19', '2026-09-19')).toEqual({ status: 'ok', days: 1 });
    expect(daysTogether('2026-09-19', '2026-09-20')).toEqual({ status: 'ok', days: 2 });
  });

  it('1년 뒤 같은 날은 366일이다', () => {
    expect(daysTogether('2024-11-09', '2025-11-09')).toEqual({ status: 'ok', days: 366 });
  });

  it('시작일이 없으면 배지를 숨기도록 unset을 돌려준다', () => {
    expect(daysTogether(null)).toEqual({ status: 'unset' });
    expect(daysTogether(undefined)).toEqual({ status: 'unset' });
    expect(daysTogether('')).toEqual({ status: 'unset' });
  });

  it('미래 시작일은 거부한다', () => {
    expect(daysTogether('2026-09-20', '2026-09-19')).toEqual({ status: 'future' });
  });

  it('형식이 잘못되면 invalid로 알린다', () => {
    expect(daysTogether('2026-02-30', '2026-09-19')).toEqual({ status: 'invalid' });
    expect(daysTogether('어제', '2026-09-19')).toEqual({ status: 'invalid' });
  });
});

describe('todayInSeoul', () => {
  it('UTC 자정 직후를 한국 기준 다음 날로 본다', () => {
    // 2026-09-18T16:00Z = 2026-09-19 01:00 KST
    expect(todayInSeoul(new Date('2026-09-18T16:00:00Z'))).toBe('2026-09-19');
  });

  it('UTC 기준으로는 같은 날이어도 KST 기준 날짜가 다를 수 있다', () => {
    expect(todayInSeoul(new Date('2026-09-18T14:59:59Z'))).toBe('2026-09-18');
    expect(todayInSeoul(new Date('2026-09-18T15:00:00Z'))).toBe('2026-09-19');
  });

  it('YYYY-MM-DD 형식을 지킨다', () => {
    expect(isCalendarDate(todayInSeoul(new Date('2026-01-05T02:00:00Z')))).toBe(true);
    expect(todayInSeoul(new Date('2026-01-05T02:00:00Z'))).toBe('2026-01-05');
  });
});

describe('monthKey / 표시 형식', () => {
  it('YYYY-MM 키를 만든다', () => {
    expect(monthKey('2026-09-19')).toBe('2026-09');
    expect(monthKey('2026-01-01')).toBe('2026-01');
  });

  it('isMonthKey는 월 범위를 검사한다', () => {
    expect(isMonthKey('2026-09')).toBe(true);
    expect(isMonthKey('2026-12')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(isMonthKey('2026-9')).toBe(false);
    expect(isMonthKey('')).toBe(false);
  });

  it('한국어 날짜·월 표시를 만든다', () => {
    expect(formatKoreanDate('2026-09-19')).toBe('2026년 9월 19일');
    expect(formatKoreanDate('2026-01-05')).toBe('2026년 1월 5일');
    expect(formatKoreanMonth('2026-09')).toBe('2026년 9월');
  });

  it('형식이 잘못되면 원본을 그대로 보여 준다', () => {
    expect(formatKoreanDate('알 수 없음')).toBe('알 수 없음');
    expect(formatKoreanMonth('알 수 없음')).toBe('알 수 없음');
  });
});

describe('compareCalendarDates', () => {
  it('정렬에 쓸 수 있는 -1/0/1을 돌려준다', () => {
    expect(compareCalendarDates('2026-09-19', '2026-09-18')).toBe(1);
    expect(compareCalendarDates('2026-09-18', '2026-09-19')).toBe(-1);
    expect(compareCalendarDates('2026-09-19', '2026-09-19')).toBe(0);
  });
});
