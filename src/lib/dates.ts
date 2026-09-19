import { DISPLAY_TIME_ZONE } from '@/lib/contracts';

/** `YYYY-MM-DD` 형식의 달력 날짜. 시각·타임존 정보를 담지 않는다. */
export type CalendarDate = string;

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/**
 * 달력 날짜 문자열을 파싱한다. 형식뿐 아니라 실제 존재하는 날짜인지도 확인한다.
 * (`2026-02-30`처럼 자동 보정되는 값은 거부한다.)
 */
export function parseCalendarDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function isCalendarDate(value: string): value is CalendarDate {
  return parseCalendarDate(value) !== null;
}

/** 달력 날짜를 일 단위 정수로 바꾼다. 시간 밀리초가 아닌 달력 기준 비교에 사용한다. */
function toDayNumber(value: CalendarDate): number {
  const parts = parseCalendarDate(value);
  if (!parts) {
    throw new RangeError(`달력 날짜 형식이 아닙니다: ${value}`);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day) / MS_PER_DAY;
}

/** 한국 시간 기준 오늘 날짜를 `YYYY-MM-DD`로 돌려준다. */
export function todayInSeoul(now: Date = new Date()): CalendarDate {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

/** 두 달력 날짜의 차이를 일 수로 돌려준다. `to`가 앞서면 음수다. */
export function differenceInCalendarDays(from: CalendarDate, to: CalendarDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  const diff = toDayNumber(a) - toDayNumber(b);
  if (diff > 0) return 1;
  if (diff < 0) return -1;
  return 0;
}

export type DayCountResult =
  | { status: 'ok'; days: number }
  | { status: 'unset' }
  | { status: 'future' }
  | { status: 'invalid' };

/**
 * 함께한 날짜 수를 계산한다.
 * DESIGN.md 1: 관계 시작 당일이 1일이다. 미래 시작일은 거부한다.
 */
export function daysTogether(
  startDate: CalendarDate | null | undefined,
  today: CalendarDate = todayInSeoul(),
): DayCountResult {
  if (!startDate) return { status: 'unset' };
  if (!isCalendarDate(startDate) || !isCalendarDate(today)) return { status: 'invalid' };

  const diff = differenceInCalendarDays(startDate, today);
  if (diff < 0) return { status: 'future' };
  return { status: 'ok', days: diff + 1 };
}

/** 추억 목록 필터에 사용하는 `YYYY-MM` 키. */
export function monthKey(date: CalendarDate): string {
  const parts = parseCalendarDate(date);
  if (!parts) {
    throw new RangeError(`달력 날짜 형식이 아닙니다: ${date}`);
  }
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
}

export function isMonthKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** `2026년 9월 19일` 형태로 표시한다. */
export function formatKoreanDate(date: CalendarDate): string {
  const parts = parseCalendarDate(date);
  if (!parts) return date;
  return `${parts.year}년 ${parts.month}월 ${parts.day}일`;
}

/** `2026년 9월` 형태로 표시한다. */
export function formatKoreanMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return `${Number(match[1])}년 ${Number(match[2])}월`;
}
