import { getSessionContext } from '@/features/auth/queries';
import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import { RESTAURANT_PAGE_SIZE } from './constants';
import { cursorOrFilter, toNameSearchPattern, type RestaurantCursor, type RestaurantFilters } from './filters';
import {
  buildPage,
  RESTAURANT_DETAIL_COLUMNS,
  RESTAURANT_LIST_COLUMNS,
  REVIEW_COLUMNS,
  sortReviews,
  toDetail,
  toReview,
} from './mappers';
import { isUuid } from './schema';

import type { QueryFailure, RestaurantDetailResult, RestaurantPageResult, ReviewView } from './types';

/**
 * 맛집 조회(서버 전용).
 *
 * - 사용자 세션 + RLS로만 읽는다. 서비스 키는 이 경로에 없다(CONTRACTS.md 6).
 * - `space_id` 조건은 인덱스를 타기 위해 넣는다. 접근 제어는 RLS가 한다.
 * - **조회 실패를 빈 목록이나 "없음"으로 바꾸지 않는다.** 실패는 실패로 돌려주고 화면이 재시도를 제공한다.
 * - 오류 원문(DB 메시지)은 화면·로그에 싣지 않는다.
 */

const LIST_FAILED = '맛집 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
const DETAIL_FAILED = '맛집 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
const SIGNED_OUT = '로그인이 풀렸어요. 다시 로그인한 뒤 시도해 주세요.';

function logQueryFailure(operation: string, code: string | null | undefined): void {
  console.error(`restaurants.${operation} code=${(code ?? '').trim() || 'unknown'}`);
}

type MemberScope =
  | { ok: true; spaceId: string; viewerId: string; nicknames: Map<string, string | null> }
  | QueryFailure;

async function memberScope(): Promise<MemberScope> {
  const context = await getSessionContext();
  if (context.status === 'member') {
    return {
      ok: true,
      spaceId: context.space.id,
      viewerId: context.user.id,
      nicknames: new Map(context.members.map((member) => [member.userId, member.nickname])),
    };
  }
  if (context.status === 'unconfigured') return { ok: false, message: LIST_FAILED };
  return { ok: false, message: SIGNED_OUT, unauthenticated: true };
}

async function client() {
  try {
    return await createSupabaseServerClient();
  } catch (error) {
    if (isSupabaseConfigError(error)) return null;
    throw error;
  }
}

export async function listRestaurants(
  filters: RestaurantFilters,
  cursor: RestaurantCursor | null,
  pageSize: number = RESTAURANT_PAGE_SIZE,
): Promise<RestaurantPageResult> {
  const scope = await memberScope();
  if (!scope.ok) return scope;

  const supabase = await client();
  if (!supabase) return { ok: false, message: LIST_FAILED };

  let query = supabase.from('restaurants').select(RESTAURANT_LIST_COLUMNS).eq('space_id', scope.spaceId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.area) query = query.eq('area', filters.area);
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.q) query = query.ilike('name', toNameSearchPattern(filters.q));
  if (cursor) query = query.or(cursorOrFilter(cursor));

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1);

  if (error || !Array.isArray(data)) {
    logQueryFailure('list', error?.code);
    return { ok: false, message: LIST_FAILED };
  }

  const page = buildPage(data as unknown as Record<string, unknown>[], pageSize);
  if (!page) {
    logQueryFailure('list', 'shape');
    return { ok: false, message: LIST_FAILED };
  }
  return { ok: true, ...page };
}

/** 지역·음식 종류 입력 제안. 실패해도 목록에는 영향이 없으므로 빈 제안으로 둔다(데이터가 없다고 말하지 않는다). */
export async function listFilterSuggestions(): Promise<{ areas: string[]; categories: string[] }> {
  const empty = { areas: [], categories: [] };
  const scope = await memberScope();
  if (!scope.ok) return empty;
  const supabase = await client();
  if (!supabase) return empty;

  const { data, error } = await supabase
    .from('restaurants')
    .select('area, category')
    .eq('space_id', scope.spaceId)
    .limit(500);
  if (error || !Array.isArray(data)) {
    logQueryFailure('suggestions', error?.code);
    return empty;
  }

  const areas = new Set<string>();
  const categories = new Set<string>();
  for (const row of data as { area?: unknown; category?: unknown }[]) {
    if (typeof row.area === 'string' && row.area !== '') areas.add(row.area);
    if (typeof row.category === 'string' && row.category !== '') categories.add(row.category);
  }
  const collator = new Intl.Collator('ko');
  return {
    areas: [...areas].sort(collator.compare),
    categories: [...categories].sort(collator.compare),
  };
}

export async function getRestaurantDetail(id: string): Promise<RestaurantDetailResult> {
  // 형식이 맞지 않는 ID는 존재하지 않는 것과 같은 404로 다룬다(DESIGN 3).
  if (!isUuid(id)) return { status: 'not_found' };

  const scope = await memberScope();
  if (!scope.ok) return { status: 'error', message: scope.message };

  const supabase = await client();
  if (!supabase) return { status: 'error', message: DETAIL_FAILED };

  const { data: row, error } = await supabase
    .from('restaurants')
    .select(RESTAURANT_DETAIL_COLUMNS)
    .eq('id', id)
    .eq('space_id', scope.spaceId)
    .maybeSingle();

  if (error) {
    logQueryFailure('detail', error.code);
    return { status: 'error', message: DETAIL_FAILED };
  }
  // 없거나 다른 공간의 맛집은 같은 404다(RLS가 행을 숨긴다).
  if (!row) return { status: 'not_found' };

  const restaurant = toDetail(row as unknown as Record<string, unknown>);
  if (!restaurant) {
    logQueryFailure('detail', 'shape');
    return { status: 'error', message: DETAIL_FAILED };
  }

  const { data: reviewRows, error: reviewError } = await supabase
    .from('restaurant_reviews')
    .select(REVIEW_COLUMNS)
    .eq('restaurant_id', restaurant.id)
    .order('created_at', { ascending: true });

  if (reviewError || !Array.isArray(reviewRows)) {
    logQueryFailure('reviews', reviewError?.code);
    return { status: 'error', message: DETAIL_FAILED };
  }

  const reviews: ReviewView[] = [];
  for (const reviewRow of reviewRows as unknown as Record<string, unknown>[]) {
    const review = toReview(reviewRow, scope.viewerId, scope.nicknames);
    if (!review) {
      logQueryFailure('reviews', 'shape');
      return { status: 'error', message: DETAIL_FAILED };
    }
    reviews.push(review);
  }

  return { status: 'ok', restaurant, reviews: sortReviews(reviews) };
}
