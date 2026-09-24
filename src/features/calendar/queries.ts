import { getSessionContext } from '@/features/auth/queries';
import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import { MONTH_EVENT_LIMIT, WISH_OPTION_LIMIT } from './constants';
import { seoulDayStartUtc } from './datetime';
import { matchesScope, type CalendarFilters } from './filters';
import {
  CALENDAR_DETAIL_COLUMNS,
  CALENDAR_LIST_COLUMNS,
  compareEvents,
  toDetail,
  toListItems,
  type ViewerScope,
} from './mappers';
import { firstDayOfMonth, firstDayOfNextMonth } from './month';
import { isUuid } from './schema';

import type {
  CalendarEventDetailResult,
  CalendarMonthResult,
  QueryFailure,
  WishOptionsResult,
} from './types';

/**
 * 캘린더 조회(서버 전용).
 *
 * - 사용자 세션 + RLS로만 읽는다. 서비스 키는 이 경로에 없다(CONTRACTS.md 6).
 * - `space_id` 조건은 인덱스를 타기 위해 넣는다. 접근 제어는 RLS가 한다.
 * - 개인 일정은 **두 사람 모두** 조회한다. 바꿀 수 있는지는 행마다 `canEdit`으로 구분한다(DESIGN 6).
 * - **조회 실패를 빈 목록이나 "없음"으로 바꾸지 않는다.** 실패는 실패로 돌려주고 화면이 재시도를 제공한다.
 * - 오류 원문(DB 메시지)은 화면·로그에 싣지 않는다.
 */

const MONTH_FAILED = '일정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
const DETAIL_FAILED = '일정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
const WISHES_FAILED = '위시 목록을 불러오지 못했어요. 위시 연결 없이 저장할 수 있어요.';
const SIGNED_OUT = '로그인이 풀렸어요. 다시 로그인한 뒤 시도해 주세요.';

function logQueryFailure(operation: string, code: string | null | undefined): void {
  console.error(`calendar.${operation} code=${(code ?? '').trim() || 'unknown'}`);
}

type MemberScope = ({ ok: true; spaceId: string } & ViewerScope) | QueryFailure;

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
  if (context.status === 'unconfigured') return { ok: false, message: MONTH_FAILED };
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

/**
 * 한 달과 겹치는 일정.
 *
 * 겹침 조건은 `starts_at < 다음 달 0시` 이고 `종료(없으면 시작) >= 이번 달 0시`다.
 * 여러 날에 걸친 일정도 시작이 지난달이면 이번 달에 함께 보인다.
 * 경계는 **한국 시간 자정**이다(DESIGN 1).
 */
export async function listMonthEvents(
  filters: CalendarFilters,
  limit: number = MONTH_EVENT_LIMIT,
): Promise<CalendarMonthResult> {
  const scope = await memberScope();
  if (!scope.ok) return scope;

  const supabase = await client();
  if (!supabase) return { ok: false, message: MONTH_FAILED };

  const rangeStart = seoulDayStartUtc(firstDayOfMonth(filters.month));
  const rangeEnd = seoulDayStartUtc(firstDayOfNextMonth(filters.month));

  let query = supabase
    .from('calendar_events')
    .select(CALENDAR_LIST_COLUMNS)
    .eq('space_id', scope.spaceId)
    .lt('starts_at', rangeEnd)
    .or(`ends_at.gte.${rangeStart},and(ends_at.is.null,starts_at.gte.${rangeStart})`);

  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query
    .order('starts_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit + 1);

  if (error || !Array.isArray(data)) {
    logQueryFailure('month', error?.code);
    return { ok: false, message: MONTH_FAILED };
  }

  const truncated = data.length > limit;
  const items = toListItems(data.slice(0, limit) as unknown as Record<string, unknown>[], scope);
  if (!items) {
    logQueryFailure('month', 'shape');
    return { ok: false, message: MONTH_FAILED };
  }

  // 누구의 일정인지는 행을 받은 뒤 거른다. DB에는 "내/상대" 개념이 없고 owner_id만 있다.
  const events = items
    .filter((event) => matchesScope(filters, event, scope.viewerId))
    .sort(compareEvents);

  return { ok: true, events, truncated };
}

export async function getCalendarEventDetail(id: string): Promise<CalendarEventDetailResult> {
  // 형식이 맞지 않는 ID는 존재하지 않는 것과 같은 404로 다룬다(DESIGN 3).
  if (!isUuid(id)) return { status: 'not_found' };

  const scope = await memberScope();
  if (!scope.ok) return { status: 'error', message: scope.message };

  const supabase = await client();
  if (!supabase) return { status: 'error', message: DETAIL_FAILED };

  const { data: row, error } = await supabase
    .from('calendar_events')
    .select(CALENDAR_DETAIL_COLUMNS)
    .eq('id', id)
    .eq('space_id', scope.spaceId)
    .maybeSingle();

  if (error) {
    logQueryFailure('detail', error.code);
    return { status: 'error', message: DETAIL_FAILED };
  }
  // 없거나 다른 공간의 일정은 같은 404다(RLS가 행을 숨긴다).
  if (!row) return { status: 'not_found' };

  const event = toDetail(row as unknown as Record<string, unknown>, scope);
  if (!event) {
    logQueryFailure('detail', 'shape');
    return { status: 'error', message: DETAIL_FAILED };
  }

  if (event.wishItemId) {
    // 연결한 위시의 제목만 따로 읽는다. 읽지 못해도 일정 자체는 보여 준다.
    const { data: wishRow, error: wishError } = await supabase
      .from('wish_items')
      .select('id, title')
      .eq('id', event.wishItemId)
      .eq('space_id', scope.spaceId)
      .maybeSingle();
    if (wishError) {
      logQueryFailure('detailWish', wishError.code);
    } else if (wishRow && typeof wishRow.title === 'string') {
      event.linkedWish = { id: String(wishRow.id), title: wishRow.title };
    }
  }

  return { status: 'ok', event };
}

/** 일정 만들기·수정 화면에서 고를 수 있는 위시. 실패해도 일정 저장 자체는 막지 않는다. */
export async function listWishOptions(limit: number = WISH_OPTION_LIMIT): Promise<WishOptionsResult> {
  const scope = await memberScope();
  if (!scope.ok) return scope;

  const supabase = await client();
  if (!supabase) return { ok: false, message: WISHES_FAILED };

  const { data, error } = await supabase
    .from('wish_items')
    .select('id, title, status')
    .eq('space_id', scope.spaceId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (error || !Array.isArray(data)) {
    logQueryFailure('wishOptions', error?.code);
    return { ok: false, message: WISHES_FAILED };
  }

  const wishes = [];
  for (const row of data as unknown as Record<string, unknown>[]) {
    const id = row.id;
    const title = row.title;
    const status = row.status;
    if (typeof id !== 'string' || typeof title !== 'string' || typeof status !== 'string') {
      logQueryFailure('wishOptions', 'shape');
      return { ok: false, message: WISHES_FAILED };
    }
    wishes.push({ id, title, status });
  }
  return { ok: true, wishes };
}
