import Link from 'next/link';

import { formatKoreanMonth } from '@/lib/dates';

import { KIND_ICONS } from '../constants';
import { formatKoreanDateWithWeekday, shortTimeLabel } from '../datetime';
import { buildCalendarHref, type CalendarFilters } from '../filters';
import { gridEventsByDate } from '../grouping';
import { firstDayOfMonth, firstDayOfNextMonth, monthGrid, WEEKDAY_HEADERS } from '../month';

import type { CalendarEventItem } from '../types';
import type { CalendarDate } from '@/lib/dates';

/**
 * 월 보기(서버 컴포넌트).
 *
 * - 달력은 `table`로 그린다. 요일 머리글이 `th scope="col"`이라 각 칸이 어느 요일인지 보조 기술이
 *   프로그램적으로 알 수 있고, 칸마다 한국 날짜를 붙여 "며칠"인지도 읽힌다(독립 검토 P3-7).
 * - 일요일 시작, 앞뒤 달로 채운 6주 이내 격자. **앞뒤 달 칸에는 일정을 그리지 않는다**
 *   (조회 범위가 이번 달이라 그 칸에 일부 일정만 나타나는 것을 막는다, P3-2).
 * - 여러 날에 걸친 일정은 이번 달 안에서 걸친 날마다 보인다.
 * - 취소한 일정은 취소선과 글자로 함께 구분한다(색만으로 구분하지 않는다, PROJECT_PLAN 5).
 * - 날짜를 누르면 그 날짜로 새 일정을 만든다(앞뒤 달 칸도 그 날짜로 만들 수 있다).
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
  const grouped = gridEventsByDate(events, {
    from: firstDayOfMonth(filters.month),
    toExclusive: firstDayOfNextMonth(filters.month),
  });
  const back = buildCalendarHref(filters);

  return (
    <div className="app-card overflow-hidden p-0">
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">
          {formatKoreanMonth(filters.month)} 달력. 이 달에 속한 날짜의 일정만 보여 줘요.
        </caption>
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            {WEEKDAY_HEADERS.map((label) => (
              <th
                key={label}
                scope="col"
                className="px-1 py-2 text-center text-xs font-semibold text-muted"
              >
                <abbr title={`${label}요일`} className="no-underline">
                  {label}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]?.date}>
              {week.map((day) => {
                const dayEvents = day.inMonth ? (grouped.get(day.date) ?? []) : [];
                const isToday = day.date === today;
                const label = formatKoreanDateWithWeekday(day.date);
                return (
                  <td
                    key={day.date}
                    data-testid="calendar-day"
                    data-date={day.date}
                    data-in-month={day.inMonth ? 'true' : 'false'}
                    className={`h-[6.5rem] min-w-0 border-b border-r border-border p-1.5 align-top last:border-r-0 ${
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
                        aria-label={`${label}에 일정 추가`}
                      >
                        {Number(day.date.slice(8, 10))}
                      </Link>
                      {isToday ? <span className="text-[10px] text-accent">오늘</span> : null}
                    </div>

                    {dayEvents.length > 0 ? (
                      <ul className="mt-1 space-y-1" aria-label={`${label} 일정`}>
                        {dayEvents.map((event) => (
                          <li key={`${day.date}-${event.id}`}>
                            <Link
                              href={`/calendar/${event.id}?back=${encodeURIComponent(back)}`}
                              data-testid="calendar-day-event"
                              // `relative`는 장식이 아니다. 아래 `sr-only` 배지는 절대 배치인데,
                              // `overflow: hidden`은 **자기 컨테이닝 블록이 아닌** 조상에서는 절대 배치
                              // 자손을 자르지 않는다. 그래서 이 칩이 컨테이닝 블록이 되어야 `truncate`의
                              // 자르기가 그 배지에도 적용된다. 없으면 긴 제목 뒤로 밀린 배지가 화면 밖에
                              // 남아 문서 가로 스크롤을 만든다(자세한 수치는 MonthGrid 회귀 테스트에 있다).
                              className={`relative block truncate rounded-md px-1.5 py-1 text-[11px] leading-tight ${
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
                              {event.status === 'done' ? (
                                <span className="sr-only"> (완료)</span>
                              ) : null}
                              {event.status === 'cancelled' ? (
                                <span className="sr-only"> (취소)</span>
                              ) : null}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
