import { getSessionContext } from '@/features/auth/queries';
import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import { WISH_PAGE_SIZE } from './constants';
import { cursorOrFilter, toTitleSearchPattern, type WishCursor, type WishFilters } from './filters';
import { buildPage, toDetail, WISH_DETAIL_COLUMNS, WISH_LIST_COLUMNS } from './mappers';
import { isUuid } from './schema';

import type { QueryFailure, WishDetailResult, WishPageResult } from './types';

/**
 * 위시 조회(서버 전용).
 *
 * - 사용자 세션 + RLS로만 읽는다. 서비스 키는 이 경로에 없다(CONTRACTS.md 6).
 * - `space_id` 조건은 인덱스를 타기 위해 넣는다. 접근 제어는 RLS가 한다.
 * - **조회 실패를 빈 목록이나 "없음"으로 바꾸지 않는다.** 실패는 실패로 돌려주고 화면이 재시도를 제공한다.
 * - 오류 원문(DB 메시지)은 화면·로그에 싣지 않는다.
 */

const LIST_FAILED = '위시 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
const DETAIL_FAILED = '위시를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
const SIGNED_OUT = '로그인이 풀렸어요. 다시 로그인한 뒤 시도해 주세요.';

function logQueryFailure(operation: string, code: string | null | undefined): void {
  console.error(`wishes.${operation} code=${(code ?? '').trim() || 'unknown'}`);
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

export async function listWishes(
  filters: WishFilters,
  cursor: WishCursor | null,
  pageSize: number = WISH_PAGE_SIZE,
): Promise<WishPageResult> {
  const scope = await memberScope();
  if (!scope.ok) return scope;

  const supabase = await client();
  if (!supabase) return { ok: false, message: LIST_FAILED };

  let query = supabase.from('wish_items').select(WISH_LIST_COLUMNS).eq('space_id', scope.spaceId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.q) query = query.ilike('title', toTitleSearchPattern(filters.q));
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

export async function getWishDetail(id: string): Promise<WishDetailResult> {
  // 형식이 맞지 않는 ID는 존재하지 않는 것과 같은 404로 다룬다(DESIGN 3).
  if (!isUuid(id)) return { status: 'not_found' };

  const scope = await memberScope();
  if (!scope.ok) return { status: 'error', message: scope.message };

  const supabase = await client();
  if (!supabase) return { status: 'error', message: DETAIL_FAILED };

  const { data: row, error } = await supabase
    .from('wish_items')
    .select(WISH_DETAIL_COLUMNS)
    .eq('id', id)
    .eq('space_id', scope.spaceId)
    .maybeSingle();

  if (error) {
    logQueryFailure('detail', error.code);
    return { status: 'error', message: DETAIL_FAILED };
  }
  // 없거나 다른 공간의 위시는 같은 404다(RLS가 행을 숨긴다).
  if (!row) return { status: 'not_found' };

  const wish = toDetail(row as unknown as Record<string, unknown>, scope.viewerId, scope.nicknames);
  if (!wish) {
    logQueryFailure('detail', 'shape');
    return { status: 'error', message: DETAIL_FAILED };
  }

  return { status: 'ok', wish };
}
