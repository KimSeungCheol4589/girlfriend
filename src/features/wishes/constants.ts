/**
 * 위시 기능 계약 상수.
 *
 * 기준: DESIGN.md 5.2·5.3·7·9, `supabase/migrations/20260923120100_wish_items_wish001.sql`의 CHECK 제약과 RPC.
 * 화면·Server Action 검증은 "먼저 걸러 주는 안내"이고 최종 방어는 DB 함수다.
 *
 * 값을 바꾸려면 마이그레이션의 제약도 함께 바꿔야 한다. 한쪽만 바꾸면 화면이 통과시킨 입력을 DB가 거부한다.
 * (공용 `src/lib/contracts.ts`는 다른 작업이 함께 쓰는 파일이라 이 작업에서 건드리지 않는다.
 *  통합 뒤 총괄이 옮길 수 있다.)
 */

export const WISH_LIMITS = {
  /** DB: wish_items_title_length (1~100). */
  titleMin: 1,
  titleMax: 100,
  /** DB: wish_items_memo_length (≤2,000). */
  memoMax: 2_000,
  /** DB: wish_items_link_url_length (11~500). */
  linkUrlMin: 11,
  linkUrlMax: 500,
  /** 제목 검색어 상한. 부분 일치라 제목 최대 길이면 충분하다. */
  searchMax: 100,
} as const;

// ---------------------------------------------------------------------------
// 분류
// ---------------------------------------------------------------------------

/** DB: wish_items_category_allowed. 순서가 곧 화면의 탭·선택지 순서다. */
export const WISH_CATEGORIES = ['place', 'activity', 'trip', 'shopping', 'other'] as const;
export type WishCategory = (typeof WISH_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<WishCategory, string> = {
  place: '장소',
  activity: '활동',
  trip: '여행',
  shopping: '쇼핑',
  other: '기타',
};

/** 색상만으로 구분하지 않도록 글자와 함께 쓰는 기호(PROJECT_PLAN 5). */
export const CATEGORY_ICONS: Record<WishCategory, string> = {
  place: '📍',
  activity: '🎯',
  trip: '✈️',
  shopping: '🛍️',
  other: '✨',
};

export const DEFAULT_CATEGORY: WishCategory = 'other';

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

/** DB: wish_items_status_allowed. `wish → planned → done`이 기본 흐름이다(DESIGN 5.3). */
export const WISH_STATUSES = ['wish', 'planned', 'done'] as const;
export type WishStatus = (typeof WISH_STATUSES)[number];

export const STATUS_LABELS: Record<WishStatus, string> = {
  wish: '하고 싶어요',
  planned: '계획했어요',
  done: '해냈어요',
};

export const STATUS_ICONS: Record<WishStatus, string> = {
  wish: '☆',
  planned: '🗓',
  done: '✓',
};

/**
 * 계획일을 가질 수 있는 상태.
 * `wish`로 되돌리면 DB가 계획일을 비운다(마이그레이션의 `wish_items_plan_consistent`).
 */
export function allowsPlannedDate(status: WishStatus): boolean {
  return status !== 'wish';
}

/** 목록 한 번에 불러오는 개수(DESIGN 3의 "더 보기"와 같은 단위). */
export const WISH_PAGE_SIZE = 20;
