/**
 * 캘린더 기능 계약 상수.
 *
 * 기준: DESIGN.md 5.2·5.3·6·7, `supabase/migrations/20260923140100_calendar_events_cal001.sql`의
 * CHECK 제약·트리거·RPC.
 * 화면·Server Action 검증은 "먼저 걸러 주는 안내"이고 최종 방어는 DB 함수다.
 *
 * 값을 바꾸려면 마이그레이션의 제약도 함께 바꿔야 한다. 한쪽만 바꾸면 화면이 통과시킨 입력을 DB가 거부한다.
 * (공용 `src/lib/contracts.ts`는 다른 작업이 함께 쓰는 파일이라 이 작업에서 건드리지 않는다.
 *  통합 뒤 총괄이 옮길 수 있다.)
 */

export const CALENDAR_LIMITS = {
  /** DB: calendar_events_title_length (1~100). */
  titleMin: 1,
  titleMax: 100,
  /** DB: calendar_events_location_length (≤100). */
  locationMax: 100,
  /** DB: calendar_events_note_length (≤2,000). */
  noteMax: 2_000,
} as const;

// ---------------------------------------------------------------------------
// 종류: 개인 일정 / 공동 데이트 일정
// ---------------------------------------------------------------------------

/** DB: calendar_events_kind_allowed. `personal`은 owner가 있고 `date`는 owner가 null이다. */
export const EVENT_KINDS = ['personal', 'date'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const KIND_LABELS: Record<EventKind, string> = {
  personal: '내 개인 일정',
  date: '함께하는 데이트',
};

/** 색상만으로 구분하지 않도록 글자와 함께 쓰는 기호(PROJECT_PLAN 5). */
export const KIND_ICONS: Record<EventKind, string> = {
  personal: '🙋',
  date: '💞',
};

export const KIND_HINTS: Record<EventKind, string> = {
  personal: '상대방도 볼 수 있지만 고치거나 완료 체크는 만든 사람만 해요.',
  date: '두 사람 모두 고치고 완료 체크할 수 있어요.',
};

export const DEFAULT_KIND: EventKind = 'date';

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

/** DB: calendar_events_status_allowed. 완료 체크는 삭제와 구분한다(DESIGN 5.3). */
export const EVENT_STATUSES = ['scheduled', 'done', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const STATUS_LABELS: Record<EventStatus, string> = {
  scheduled: '예정',
  done: '완료',
  cancelled: '취소',
};

export const STATUS_ICONS: Record<EventStatus, string> = {
  scheduled: '🗓',
  done: '✓',
  cancelled: '✕',
};

/**
 * 상태를 바꾸는 버튼의 글자.
 *
 * `${라벨}로 바꾸기`로 조립하지 않는다. 한국어 조사는 앞 글자의 받침에 따라 달라져
 * `예정` + `로`가 "예정로"가 된다. 문장을 값마다 그대로 적는다.
 */
export const STATUS_ACTION_LABELS: Record<EventStatus, string> = {
  scheduled: '예정으로 바꾸기',
  done: '완료로 바꾸기',
  cancelled: '취소로 바꾸기',
};

export const DEFAULT_STATUS: EventStatus = 'scheduled';

// ---------------------------------------------------------------------------
// 보기와 필터
// ---------------------------------------------------------------------------

/** DESIGN 3: `/calendar`는 월 보기와 목록 보기를 제공한다. */
export const CALENDAR_VIEWS = ['month', 'list'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const VIEW_LABELS: Record<CalendarView, string> = {
  month: '월 보기',
  list: '목록 보기',
};

/** 누구의 일정인지로 거르는 값. `mine`/`partner`는 개인 일정, `shared`는 공동 일정이다. */
export const CALENDAR_SCOPES = ['mine', 'partner', 'shared'] as const;
export type CalendarScope = (typeof CALENDAR_SCOPES)[number];

export const SCOPE_LABELS: Record<CalendarScope, string> = {
  mine: '내 일정',
  partner: '상대 일정',
  shared: '함께',
};

/**
 * 한 달 조회 상한.
 *
 * 한 달치는 페이지를 나눌 만큼 많지 않아 커서 페이지네이션을 두지 않는다.
 * 대신 상한을 넘으면 **조용히 자르지 않고** 화면에서 그 사실을 알린다.
 */
export const MONTH_EVENT_LIMIT = 500;

/** 일정 만들기 화면에서 고를 수 있는 위시 개수 상한. */
export const WISH_OPTION_LIMIT = 100;
