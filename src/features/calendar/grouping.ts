import { compareEvents } from './mappers';
import { datesBetween } from './month';

import type { CalendarEventItem } from './types';
import type { CalendarDate } from '@/lib/dates';

/**
 * 일정을 날짜별로 묶는다 — 순수 함수.
 *
 * 여러 날에 걸친 일정은 걸친 날마다 모두 나타난다(월 보기의 칸, 목록의 날짜 묶음).
 * 날짜는 한국 시간 기준 달력 날짜다.
 */

/** 이 일정이 걸쳐 있는 한국 날짜 목록. 종료가 없으면 시작일 하루다. */
export function eventDates(event: CalendarEventItem): CalendarDate[] {
  if (event.endDate <= event.startDate) return [event.startDate];
  return datesBetween(event.startDate, event.endDate);
}

export function groupByDate(
  events: readonly CalendarEventItem[],
): Map<CalendarDate, CalendarEventItem[]> {
  const grouped = new Map<CalendarDate, CalendarEventItem[]>();
  for (const event of events) {
    for (const date of eventDates(event)) {
      const bucket = grouped.get(date);
      if (bucket) bucket.push(event);
      else grouped.set(date, [event]);
    }
  }
  for (const bucket of grouped.values()) bucket.sort(compareEvents);
  return grouped;
}

/**
 * 월 격자에 그릴 날짜별 일정.
 *
 * 격자는 첫 주·마지막 주를 앞뒤 달 날짜로 채운다. 그런데 조회는 **보고 있는 달과 겹치는** 일정만
 * 가져오므로, 그 앞뒤 칸에는 "이번 달에 걸친 여러 날 일정"만 우연히 나타나고 그 날 하루짜리 일정은
 * 나타나지 않는다. 같은 칸에서 어떤 일정은 보이고 어떤 일정은 안 보이는 셈이다(독립 검토 P3-2).
 *
 * 그래서 앞뒤 달 칸은 **날짜 자리만** 두고 일정을 담지 않는다. 목록 보기도 같은 달 범위만 보여 주므로
 * 두 보기가 같은 규칙을 쓴다. 그 달 일정을 보려면 달을 옮긴다.
 */
export function gridEventsByDate(
  events: readonly CalendarEventItem[],
  range: { from: CalendarDate; toExclusive: CalendarDate },
): Map<CalendarDate, CalendarEventItem[]> {
  const grouped = groupByDate(events);
  for (const date of [...grouped.keys()]) {
    if (date < range.from || date >= range.toExclusive) grouped.delete(date);
  }
  return grouped;
}

export type DayGroup = { date: CalendarDate; events: CalendarEventItem[] };

/**
 * 목록 보기용 날짜 묶음. 날짜 오름차순이며, 보고 있는 달 밖의 날짜는 제외한다.
 * (지난달에 시작한 여러 날 일정은 이번 달의 걸친 날에만 나타난다.)
 */
export function dayGroups(
  events: readonly CalendarEventItem[],
  range: { from: CalendarDate; toExclusive: CalendarDate },
): DayGroup[] {
  const grouped = groupByDate(events);
  return [...grouped.entries()]
    .filter(([date]) => date >= range.from && date < range.toExclusive)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, dayEvents]) => ({ date, events: dayEvents }));
}
