import {
  CALENDAR_SCOPES,
  CALENDAR_VIEWS,
  EVENT_STATUSES,
  type CalendarScope,
  type CalendarView,
  type EventStatus,
} from './constants';
import { currentMonthKey, parseMonthKey, type MonthKey } from './month';

/**
 * 캘린더 화면 필터와 주소.
 *
 * DESIGN 3: 필터는 URL 검색 매개변수에 담아 뒤로 가기에도 유지한다.
 * 달 단위 조회라 커서는 두지 않는다(한 달치는 페이지를 나눌 만큼 많지 않다).
 */

export type CalendarFilters = {
  month: MonthKey;
  view: CalendarView;
  /** 비어 있으면 모두 보여 준다. 고른 값만 남긴다. */
  scopes: CalendarScope[];
  status: EventStatus | null;
};

type RawParam = string | string[] | undefined;

function first(value: RawParam): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** URL에서 필터를 읽는다. 알 수 없는 값은 버린다. */
export function parseCalendarFilters(
  params: Record<string, RawParam>,
  today?: string,
): CalendarFilters {
  const viewRaw = first(params.view).trim();
  const view = (CALENDAR_VIEWS as readonly string[]).includes(viewRaw)
    ? (viewRaw as CalendarView)
    : 'month';

  const statusRaw = first(params.status).trim();
  const status = (EVENT_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as EventStatus)
    : null;

  // `scope`는 여러 번 올 수 있다. 순서를 상수 순서로 고정해 같은 필터가 같은 주소가 되게 한다.
  const rawScopes = params.scope;
  const picked = new Set(
    (Array.isArray(rawScopes) ? rawScopes : rawScopes === undefined ? [] : [rawScopes])
      .map((value) => value.trim())
      .filter((value): value is CalendarScope =>
        (CALENDAR_SCOPES as readonly string[]).includes(value),
      ),
  );
  const scopes = CALENDAR_SCOPES.filter((scope) => picked.has(scope));

  return {
    month: parseMonthKey(first(params.month), today ? currentMonthKey(today) : currentMonthKey()),
    view,
    // 전부 고른 것과 아무것도 고르지 않은 것은 같은 뜻이다. "모두"로 통일한다.
    scopes: scopes.length === CALENDAR_SCOPES.length ? [] : scopes,
    status,
  };
}

export function hasActiveFilter(filters: CalendarFilters): boolean {
  return filters.scopes.length > 0 || filters.status !== null;
}

/** 필터를 URL로 만든다. 순서를 고정해 같은 필터는 같은 주소가 되게 한다. */
export function buildCalendarHref(filters: CalendarFilters): string {
  const params = new URLSearchParams();
  params.set('month', filters.month);
  if (filters.view !== 'month') params.set('view', filters.view);
  for (const scope of CALENDAR_SCOPES) {
    if (filters.scopes.includes(scope)) params.append('scope', scope);
  }
  if (filters.status) params.set('status', filters.status);
  return `/calendar?${params.toString()}`;
}

/**
 * "돌아갈 캘린더 주소".
 *
 * 상세·등록 화면은 보고 있던 달·필터로 돌아가기 위해 `back`을 받는다. 받은 값을 그대로 쓰지 않고
 * **검색 매개변수만 읽어 다시 만든다.** 그래서 결과는 언제나 우리가 만든 `/calendar?...` 형태이고,
 * 외부 주소나 다른 경로로 보내는 값이 끼어들 수 없다(경로 부분은 아예 버린다).
 */
export function parseCalendarBackHref(raw: unknown, today?: string): string {
  const query = typeof raw === 'string' ? raw.slice(raw.indexOf('?') + 1) : '';
  const params = new URLSearchParams(typeof raw === 'string' && raw.includes('?') ? query : '');
  const record: Record<string, RawParam> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    record[key] = all.length > 1 ? all : (all[0] ?? '');
  }
  return buildCalendarHref(parseCalendarFilters(record, today));
}

/** 범위 칩을 눌렀을 때의 다음 필터(켜고 끄기). */
export function toggleScope(filters: CalendarFilters, scope: CalendarScope): CalendarFilters {
  const next = filters.scopes.includes(scope)
    ? filters.scopes.filter((value) => value !== scope)
    : CALENDAR_SCOPES.filter((value) => value === scope || filters.scopes.includes(value));
  return { ...filters, scopes: next.length === CALENDAR_SCOPES.length ? [] : next };
}

/** 고른 범위에 이 일정이 들어가는지. 아무것도 고르지 않았으면 모두 보여 준다. */
export function matchesScope(
  filters: CalendarFilters,
  event: { kind: string; ownerId: string | null },
  viewerId: string,
): boolean {
  if (filters.scopes.length === 0) return true;
  const scope: CalendarScope =
    event.kind === 'date' || event.ownerId === null
      ? 'shared'
      : event.ownerId === viewerId
        ? 'mine'
        : 'partner';
  return filters.scopes.includes(scope);
}
