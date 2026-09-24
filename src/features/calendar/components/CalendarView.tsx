import Link from 'next/link';

import { EmptyState } from '@/components/EmptyState';
import { ErrorNotice } from '@/components/ErrorNotice';
import { formatKoreanMonth, type CalendarDate } from '@/lib/dates';

import {
  CALENDAR_SCOPES,
  CALENDAR_VIEWS,
  EVENT_STATUSES,
  MONTH_EVENT_LIMIT,
  SCOPE_LABELS,
  STATUS_ICONS,
  STATUS_LABELS,
  VIEW_LABELS,
} from '../constants';
import {
  buildCalendarHref,
  hasActiveFilter,
  toggleScope,
  type CalendarFilters,
} from '../filters';
import { currentMonthKey, shiftMonth } from '../month';

import { EventList } from './EventList';
import { MonthGrid } from './MonthGrid';
import { QueryErrorNotice } from './QueryErrorNotice';

import type { CalendarMonthResult } from '../types';

function Pill({
  href,
  label,
  active,
  ariaLabel,
}: {
  href: string;
  label: string;
  active: boolean;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex min-h-touch items-center rounded-pill border px-4 text-sm font-medium transition-colors ${
        active
          ? 'border-accent bg-accent text-accent-contrast'
          : 'border-border bg-surface text-muted hover:bg-surface-muted hover:text-text'
      }`}
    >
      {label}
    </Link>
  );
}

/**
 * 캘린더 화면(서버 컴포넌트).
 *
 * 필터·달·보기 방식은 모두 URL 검색 매개변수다(DESIGN 3). 링크로만 바꾸므로 자바스크립트 없이도
 * 동작하고, 뒤로 가기로 이전 상태에 돌아갈 수 있다.
 */
export function CalendarView({
  filters,
  result,
  today,
}: {
  filters: CalendarFilters;
  result: CalendarMonthResult;
  today: CalendarDate;
}) {
  const filtered = hasActiveFilter(filters);
  const thisMonth = currentMonthKey(today);
  const newHref = `/calendar/new?back=${encodeURIComponent(buildCalendarHref(filters))}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">커플 캘린더</h1>
          <p className="mt-1 text-sm text-muted">
            각자의 개인 일정과 함께하는 데이트 일정을 한 달력에서 봐요. 개인 일정은 만든 사람만 고칠 수
            있어요.
          </p>
        </div>
        <Link href={newHref} className="btn-primary">
          일정 추가
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="달 이동" className="flex items-center gap-2">
          <Pill
            href={buildCalendarHref({ ...filters, month: shiftMonth(filters.month, -1) })}
            label="←"
            ariaLabel="이전 달"
            active={false}
          />
          <h2 className="min-w-[7rem] text-center text-base font-bold text-text" data-testid="calendar-month">
            {formatKoreanMonth(filters.month)}
          </h2>
          <Pill
            href={buildCalendarHref({ ...filters, month: shiftMonth(filters.month, 1) })}
            label="→"
            ariaLabel="다음 달"
            active={false}
          />
          {filters.month === thisMonth ? null : (
            <Pill
              href={buildCalendarHref({ ...filters, month: thisMonth })}
              label="이번 달"
              active={false}
            />
          )}
        </nav>

        <nav aria-label="보기 방식" className="flex gap-2">
          {CALENDAR_VIEWS.map((view) => (
            <Pill
              key={view}
              href={buildCalendarHref({ ...filters, view })}
              label={VIEW_LABELS[view]}
              active={filters.view === view}
            />
          ))}
        </nav>
      </div>

      <section aria-labelledby="calendar-filters" className="app-card px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="calendar-filters" className="text-sm font-bold text-text">
            누구의 일정 · 상태
          </h2>
          {filtered ? (
            <Link
              href={buildCalendarHref({ ...filters, scopes: [], status: null })}
              className="btn-quiet !min-h-[32px] !px-3 text-xs"
            >
              필터 지우기
            </Link>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {CALENDAR_SCOPES.map((scope) => (
            <Pill
              key={scope}
              href={buildCalendarHref(toggleScope(filters, scope))}
              label={SCOPE_LABELS[scope]}
              active={filters.scopes.includes(scope)}
            />
          ))}
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <Pill
            href={buildCalendarHref({ ...filters, status: null })}
            label="모든 상태"
            active={filters.status === null}
          />
          {EVENT_STATUSES.map((status) => (
            <Pill
              key={status}
              href={buildCalendarHref({ ...filters, status })}
              label={`${STATUS_ICONS[status]} ${STATUS_LABELS[status]}`}
              active={filters.status === status}
            />
          ))}
        </div>
      </section>

      {!result.ok ? (
        <QueryErrorNotice
          title="일정을 불러오지 못했어요"
          message={result.message}
          unauthenticated={result.unauthenticated}
          loginNext="/calendar"
        />
      ) : (
        <>
          {result.truncated ? (
            <ErrorNotice
              role="status"
              title="이 달의 일정이 너무 많아요"
              description={`한 번에 ${MONTH_EVENT_LIMIT.toLocaleString('ko-KR')}개까지만 보여 줘요. 상태나 범위 필터로 좁혀서 봐 주세요.`}
            />
          ) : null}

          {result.events.length === 0 ? (
            filtered ? (
              <EmptyState
                title="조건에 맞는 일정이 없어요"
                description="범위나 상태 필터를 바꿔 보거나 필터를 지워 보세요."
                action={{
                  href: buildCalendarHref({ ...filters, scopes: [], status: null }),
                  label: '필터 지우기',
                }}
              />
            ) : (
              <EmptyState
                title={`${formatKoreanMonth(filters.month)}에는 일정이 없어요`}
                description="데이트 약속이나 각자의 일정을 적어 두면 두 사람이 같은 달력에서 볼 수 있어요."
                action={{ href: newHref, label: '첫 일정 추가' }}
              />
            )
          ) : filters.view === 'month' ? (
            <MonthGrid filters={filters} events={result.events} today={today} />
          ) : (
            <EventList filters={filters} events={result.events} today={today} />
          )}
        </>
      )}
    </div>
  );
}
