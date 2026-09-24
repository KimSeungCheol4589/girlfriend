import Link from 'next/link';

import { KIND_ICONS } from '../constants';
import { shortTimeLabel } from '../datetime';
import { buildCalendarHref, type CalendarFilters } from '../filters';
import { groupByDate } from '../grouping';
import { monthGrid, WEEKDAY_HEADERS } from '../month';

import type { CalendarEventItem } from '../types';
import type { CalendarDate } from '@/lib/dates';

/**
 * 월 보기(서버 컴포넌트).
 *
 * - 일요일 시작, 앞뒤 달로 채운 6주 이내 격자.
 * - 여러 날에 걸친 일정은 걸친 날마다 보인다.
 * - 취소한 일정은 취소선과 글자로 함께 구분한다(색만으로 구분하지 않는다, PROJECT_PLAN 5).
 * - 날짜를 누르면 그 날짜로 새 일정을 만든다.
 */
export function MonthGrid({
  filters,
  events,
  today,
}: {
  filters: CalendarFilters;
  events: CalendarEventItem[];
  today: CalendarDate;
}) {
  const weeks = monthGrid(filters.month);
  const grouped = groupByDate(events);
  const back = buildCalendarHref(filters);

  return (
    <div className="app-card overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b border-border bg-surface-muted">
        {WEEKDAY_HEADERS.map((label) => (
          <div key={label} className="px-1 py-2 text-center text-xs font-semibold text-muted">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {weeks.flat().map((day) => {
          const dayEvents = grouped.get(day.date) ?? [];
          const isToday = day.date === today;
          return (
            <div
              key={day.date}
              data-testid="calendar-day"
              data-date={day.date}
              className={`min-h-[6.5rem] border-b border-r border-border p-1.5 last:border-r-0 ${
                day.inMonth ? 'bg-surface' : 'bg-surface-muted/60'
              }`}
            >
              <div className="flex items-center justify-between">
                <Link
                  href={`/calendar/new?date=${day.date}&back=${encodeURIComponent(back)}`}
                  className={`inline-flex min-h-[24px] min-w-[24px] items-center justify-center rounded-full px-1 text-xs font-semibold ${
                    isToday
                      ? 'bg-accent text-accent-contrast'
                      : day.inMonth
                        ? 'text-text hover:bg-surface-muted'
                        : 'text-muted hover:bg-surface'
                  }`}
                  aria-label={`${day.date}에 일정 추가`}
                >
                  {Number(day.date.slice(8, 10))}
                </Link>
                {isToday ? <span className="text-[10px] text-accent">오늘</span> : null}
              </div>

              <ul className="mt-1 space-y-1">
                {dayEvents.map((event) => (
                  <li key={`${day.date}-${event.id}`}>
                    <Link
                      href={`/calendar/${event.id}?back=${encodeURIComponent(back)}`}
                      data-testid="calendar-day-event"
                      className={`block truncate rounded-md px-1.5 py-1 text-[11px] leading-tight ${
                        event.status === 'cancelled'
                          ? 'bg-surface-muted text-muted line-through'
                          : event.status === 'done'
                            ? 'bg-accent-soft text-text'
                            : 'bg-surface-muted text-text hover:bg-accent-soft'
                      }`}
                      title={event.title}
                    >
                      <span aria-hidden>{KIND_ICONS[event.kind]} </span>
                      <span className="tabular-nums">{shortTimeLabel(event)}</span>{' '}
                      <span>{event.title}</span>
                      {event.status === 'done' ? <span className="sr-only"> (완료)</span> : null}
                      {event.status === 'cancelled' ? (
                        <span className="sr-only"> (취소)</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
