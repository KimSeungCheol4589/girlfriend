import { WISH_CATEGORIES, WISH_LIMITS, WISH_STATUSES, type WishCategory, type WishStatus } from './constants';
import { codePointLength, isUuid } from './schema';

/**
 * 위시 목록 필터와 커서.
 *
 * DESIGN 3: 필터는 URL 검색 매개변수에 담아 뒤로 가기에도 유지한다.
 * 정렬은 `created_at DESC, id DESC`이고 그 쌍을 커서로 쓴다. 필터가 바뀌면 커서를 초기화한다.
 */

export type WishFilters = {
  status: WishStatus | null;
  category: WishCategory | null;
  /** 제목 부분 일치 검색어. */
  q: string;
};

export const EMPTY_FILTERS: WishFilters = { status: null, category: null, q: '' };

type RawParam = string | string[] | undefined;

function first(value: RawParam): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** 코드 포인트 기준으로 자른다(서로게이트 쌍을 반으로 자르지 않는다). */
function clip(value: string, max: number): string {
  if (codePointLength(value) <= max) return value;
  return Array.from(value).slice(0, max).join('');
}

/** URL에서 필터를 읽는다. 알 수 없는 값은 버리고 길이는 잘라 낸다. */
export function parseWishFilters(params: Record<string, RawParam>): WishFilters {
  const statusRaw = first(params.status).trim();
  const status = (WISH_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as WishStatus)
    : null;

  const categoryRaw = first(params.category).trim();
  const category = (WISH_CATEGORIES as readonly string[]).includes(categoryRaw)
    ? (categoryRaw as WishCategory)
    : null;

  return { status, category, q: clip(first(params.q).trim(), WISH_LIMITS.searchMax) };
}

export function hasActiveFilter(filters: WishFilters): boolean {
  return filters.status !== null || filters.category !== null || filters.q !== '';
}

/** 필터를 URL로 만든다. 순서를 고정해 같은 필터는 같은 주소가 되게 한다. 커서는 넣지 않는다. */
export function buildWishesHref(filters: WishFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.q) params.set('q', filters.q);
  const query = params.toString();
  return query ? `/wishes?${query}` : '/wishes';
}

/** 필터가 같은지(목록을 다시 시작해야 하는지) 판단하는 키. */
export function filtersKey(filters: WishFilters): string {
  return buildWishesHref(filters);
}

// ---------------------------------------------------------------------------
// 제목 검색 패턴
// ---------------------------------------------------------------------------

/**
 * 부분 일치용 ILIKE 패턴.
 *
 * - `\`, `%`, `_`는 PostgreSQL LIKE 이스케이프로 글자 그대로 찾게 한다.
 * - PostgREST는 패턴의 `*`를 `%`로 바꾼다. 글자 `*`를 그대로 찾을 방법이 없어
 *   한 글자 와일드카드(`_`)로 바꾼다. 결과가 조금 넓어질 수는 있어도 빠지지는 않는다.
 */
export function toTitleSearchPattern(q: string): string {
  const escaped = q
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '_');
  return `%${escaped}%`;
}

// ---------------------------------------------------------------------------
// 커서
// ---------------------------------------------------------------------------

export type WishCursor = {
  /** DB가 준 `created_at` 문자열 그대로(마이크로초 정밀도를 잃지 않도록 Date로 바꾸지 않는다). */
  createdAt: string;
  id: string;
};

const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

export function isWishCursor(value: unknown): value is WishCursor {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.createdAt === 'string' &&
    TIMESTAMP_PATTERN.test(candidate.createdAt) &&
    isUuid(candidate.id)
  );
}

/**
 * `(created_at, id) < (cursor.createdAt, cursor.id)` 조건을 PostgREST `or` 필터로 만든다.
 * 값은 위 형식 검사를 통과한 것만 들어오며, 타임스탬프는 따옴표로 감싼다(`+`, `:` 포함).
 */
export function cursorOrFilter(cursor: WishCursor): string {
  if (!isWishCursor(cursor)) throw new RangeError('잘못된 커서');
  const at = `"${cursor.createdAt}"`;
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${cursor.id.toLowerCase()})`;
}
