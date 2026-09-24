import { DISPLAY_TIME_ZONE } from '@/lib/contracts';
import { formatKoreanDate, isCalendarDate, type CalendarDate } from '@/lib/dates';

/**
 * 한국 시간(Asia/Seoul) 기준 시각 변환 — 순수 함수.
 *
 * 왜 필요한가:
 *   - DB는 `timestamptz`를 저장하고, 화면과 입력은 **한국 달력 날짜·시각**으로 다룬다(DESIGN 1).
 *   - 서버가 조립·표시를 모두 KST로 하므로 브라우저 시간대가 달라도 같은 날짜가 보인다.
 *   - 실패를 조용히 기본값으로 바꾸지 않는다. 형식이 어긋나면 `null`을 돌려주고 호출자가 실패로 다룬다.
 *
 * 한국은 일광절약시간이 없어 UTC+09:00 고정이다. 그래도 표시는 항상 Intl로 계산해
 * 오프셋을 코드에 흩뿌리지 않는다.
 */

export type ClockTime = string; // `HH:MM`

const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isClockTime(value: unknown): value is ClockTime {
  return typeof value === 'string' && CLOCK_TIME_PATTERN.test(value);
}

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export type SeoulMoment = {
  /** `YYYY-MM-DD` */
  date: CalendarDate;
  /** `HH:MM` */
  time: ClockTime;
};

/** DB가 준 timestamptz 문자열을 한국 시간의 날짜·시각으로 바꾼다. */
export function toSeoulMoment(value: unknown): SeoulMoment | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  const epoch = parsed.getTime();
  if (!Number.isFinite(epoch)) return null;

  const found: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(parsed)) {
    if (part.type !== 'literal') found[part.type] = part.value;
  }
  const date = `${found.year}-${found.month}-${found.day}`;
  const time = `${found.hour}:${found.minute}`;
  if (!isCalendarDate(date) || !isClockTime(time)) return null;
  return { date, time };
}

/**
 * 한국 시간 기준 그 날 0시의 UTC ISO 문자열.
 *
 * 조회 조건에 그대로 쓴다. `+09:00` 대신 UTC 표기를 쓰는 이유는 PostgREST의 `or` 필터에서
 * `+`를 따로 감싸지 않아도 되기 때문이다.
 */
export function seoulDayStartUtc(date: CalendarDate): string {
  if (!isCalendarDate(date)) throw new RangeError(`달력 날짜 형식이 아닙니다: ${date}`);
  // 한국은 일광절약시간이 없어 자정은 항상 UTC+09:00 기준이다.
  return new Date(`${date}T00:00:00+09:00`).toISOString();
}

// ---------------------------------------------------------------------------
// 표시
// ---------------------------------------------------------------------------

/** `14:30` → `오후 2:30`. 24시간 값을 그대로 보여 주지 않고 한국어 표기로 바꾼다. */
export function formatKoreanTime(time: ClockTime): string {
  if (!isClockTime(time)) return time;
  const [hourText, minuteText] = time.split(':');
  const hour = Number(hourText);
  const meridiem = hour < 12 ? '오전' : '오후';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${meridiem} ${display}:${minuteText}`;
}

/** `2026-11-07` → `11월 7일 (토)`. 월 보기·목록의 날짜 머리글에 쓴다. */
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function weekdayIndex(date: CalendarDate): number {
  if (!isCalendarDate(date)) throw new RangeError(`달력 날짜 형식이 아닙니다: ${date}`);
  // 정오 UTC로 만들어 시간대 보정에 흔들리지 않게 한다.
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function weekdayLabel(date: CalendarDate): string {
  return WEEKDAY_LABELS[weekdayIndex(date)] ?? '';
}

export function formatKoreanDateWithWeekday(date: CalendarDate): string {
  return `${formatKoreanDate(date)} (${weekdayLabel(date)})`;
}

export type EventTiming = {
  allDay: boolean;
  startDate: CalendarDate;
  startTime: ClockTime | null;
  /** 종일 일정은 **포함** 종료일. 시간 일정은 종료가 없으면 시작일과 같다. */
  endDate: CalendarDate;
  endTime: ClockTime | null;
  /** 종료를 실제로 저장했는지. 시간 일정은 종료가 선택이다. */
  hasEnd: boolean;
};

/** 목록·상세에 쓰는 한 줄 표기. 날짜가 걸쳐 있으면 두 날짜를 모두 보여 준다. */
export function describeTiming(timing: EventTiming): string {
  const sameDay = timing.startDate === timing.endDate;

  if (timing.allDay) {
    return sameDay
      ? `${formatKoreanDateWithWeekday(timing.startDate)} · 종일`
      : `${formatKoreanDateWithWeekday(timing.startDate)} ~ ${formatKoreanDateWithWeekday(timing.endDate)} · 종일`;
  }

  const start = `${formatKoreanDateWithWeekday(timing.startDate)} ${formatKoreanTime(timing.startTime ?? '00:00')}`;
  if (!timing.hasEnd || timing.endTime === null) return start;
  return sameDay
    ? `${start} ~ ${formatKoreanTime(timing.endTime)}`
    : `${start} ~ ${formatKoreanDateWithWeekday(timing.endDate)} ${formatKoreanTime(timing.endTime)}`;
}

/** 월 보기의 한 칸에 넣는 짧은 표기. */
export function shortTimeLabel(timing: EventTiming): string {
  return timing.allDay ? '종일' : formatKoreanTime(timing.startTime ?? '00:00');
}
