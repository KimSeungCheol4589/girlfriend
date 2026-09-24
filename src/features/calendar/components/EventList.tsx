import Link from 'next/link';

import { describeTiming, formatKoreanDateWithWeekday } from '../datetime';
import { buildCalendarHref, type CalendarFilters } from '../filters';
import { dayGroups } from '../grouping';
import { firstDayOfMonth, firstDayOfNextMonth } from '../month';

import { OwnerBadge, StatusBadge } from './Badges';

import type { CalendarEventItem } from '../types';
import type { CalendarDate } from '@/lib/dates';

/**
 * 목록 보기(서버 컴포넌트).
 *
 * 보고 있는 달의 날짜별 묶음이다. 여러 날에 걸친 일정은 걸친 날마다 보인다.
 * 한 달 단위라 "더 보기"를 두지 않는다(상한을 넘으면 상위 화면이 그 사실을 알린다).
 */
export function EventList({
  filters,
  events,
  today,
}: {
  filters: CalendarFilters;
  events: CalendarEventItem[];
  today: CalendarDate;
}) {
  const groups = dayGroups(events, {
    from: firstDayOfMonth(filters.month),
    toExclusive: firstDayOfNextMonth(filters.month),
  });
  const back = buildCalendarHref(filters);

  return (
    <div className="space-y-4" data-testid="calendar-list">
      {groups.map((group) => (
        <section key={group.date} className="app-card px-4 py-4" aria-labelledby={`day-${group.date}`}>
          <h3 id={`day-${group.date}`} className="text-sm font-bold text-text">
            {formatKoreanDateWithWeekday(group.date)}
            {group.date === today ? <span className="ml-2 text-xs text-accent">오늘</span> : null}
          </h3>
          <ul className="mt-3 space-y-2">
            {group.events.map((event) => (
              <li key={`${group.date}-${event.id}`}>
                <Link
                  href={`/calendar/${event.id}?back=${encodeURIComponent(back)}`}
                  data-testid="calendar-list-event"
                  className="block rounded-card border border-border bg-surface px-3 py-2.5 transition-colors hover:bg-surface-muted"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <OwnerBadge kind={event.kind} ownerLabel={event.ownerLabel} />
                    <StatusBadge status={event.status} />
                  </div>
                  <p
                    className={`mt-1.5 break-words text-sm font-semibold ${
                      event.status === 'cancelled' ? 'text-muted line-through' : 'text-text'
                    }`}
                  >
                    {event.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{describeTiming(event)}</p>
                  {event.location ? (
                    <p className="mt-0.5 break-words text-xs text-muted">📍 {event.location}</p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
