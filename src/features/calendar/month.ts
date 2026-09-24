import { isMonthKey, monthKey, parseCalendarDate, todayInSeoul, type CalendarDate } from '@/lib/dates';

import { weekdayIndex } from './datetime';

/**
 * 월 보기용 달력 계산 — 순수 함수.
 *
 * 모든 날짜는 한국 시간 기준 달력 날짜(`YYYY-MM-DD`)다. 시간 밀리초로 더하고 빼지 않고
 * UTC 정오를 기준으로 계산해 시간대·일광절약시간에 흔들리지 않게 한다.
 */

export type MonthKey = string; // `YYYY-MM`

const MS_PER_DAY = 86_400_000;

export function currentMonthKey(today: CalendarDate = todayInSeoul()): MonthKey {
  return monthKey(today);
}

/** URL에서 읽은 값이 `YYYY-MM`이고 실제 달이면 그대로, 아니면 이번 달. */
export function parseMonthKey(raw: unknown, fallback: MonthKey = currentMonthKey()): MonthKey {
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim();
  return isMonthKey(value) ? value : fallback;
}

function monthParts(key: MonthKey): { year: number; month: number } {
  if (!isMonthKey(key)) throw new RangeError(`달 형식이 아닙니다: ${key}`);
  const [year, month] = key.split('-').map(Number);
  return { year: year as number, month: month as number };
}

export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const { year, month } = monthParts(key);
  // 0-based 월로 옮긴 뒤 다시 되돌린다. 음수 나눗셈을 피하려고 큰 수를 더해 계산한다.
  const total = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = total - nextYear * 12 + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}

export function firstDayOfMonth(key: MonthKey): CalendarDate {
  const { year, month } = monthParts(key);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

/** 다음 달 1일. 기간 조회의 **열린** 끝으로 쓴다. */
export function firstDayOfNextMonth(key: MonthKey): CalendarDate {
  return firstDayOfMonth(shiftMonth(key, 1));
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const parts = parseCalendarDate(date);
  if (!parts) throw new RangeError(`달력 날짜 형식이 아닙니다: ${date}`);
  const moved = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * MS_PER_DAY);
  const year = String(moved.getUTCFullYear()).padStart(4, '0');
  const month = String(moved.getUTCMonth() + 1).padStart(2, '0');
  const day = String(moved.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `from`부터 `to`까지(양끝 포함)의 날짜. 역순이면 빈 배열이다. 상한을 두어 폭주를 막는다. */
export function datesBetween(from: CalendarDate, to: CalendarDate, max = 400): CalendarDate[] {
  const dates: CalendarDate[] = [];
  let cursor = from;
  for (let index = 0; index < max; index += 1) {
    if (cursor > to) break;
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export type MonthGridDay = {
  date: CalendarDate;
  /** 이 달에 속하는 날인지(앞뒤 달에서 채운 칸은 false). */
  inMonth: boolean;
  /** 일요일 0 ~ 토요일 6. */
  weekday: number;
};

/**
 * 일요일 시작 주 단위로 한 달을 채운 격자.
 * 앞뒤 달의 날짜로 첫 주·마지막 주를 채워 항상 7의 배수가 된다.
 */
export function monthGrid(key: MonthKey): MonthGridDay[][] {
  const first = firstDayOfMonth(key);
  const nextMonthFirst = firstDayOfNextMonth(key);
  const lead = weekdayIndex(first);
  const start = addDays(first, -lead);

  const weeks: MonthGridDay[][] = [];
  let cursor = start;
  // 최대 6주. 마지막 주가 이번 달을 모두 담으면 멈춘다.
  for (let week = 0; week < 6; week += 1) {
    const days: MonthGridDay[] = [];
    for (let day = 0; day < 7; day += 1) {
      days.push({
        date: cursor,
        inMonth: cursor >= first && cursor < nextMonthFirst,
        weekday: day,
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(days);
    if (cursor >= nextMonthFirst) break;
  }
  return weeks;
}

export const WEEKDAY_HEADERS = ['일', '월', '화', '수', '목', '금', '토'] as const;
