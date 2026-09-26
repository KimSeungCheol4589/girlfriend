import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { CATEGORY_LABELS, STATUS_LABELS as WISH_STATUS_LABELS } from '@/features/wishes/constants';
import { getWishDetail } from '@/features/wishes/queries';
import { describeTiming, toSeoulMoment } from '@/features/calendar/datetime';
import { getCalendarEventDetail } from '@/features/calendar/queries';
import { getSessionContext } from '@/features/auth/queries';
import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { formatKoreanDate, isCalendarDate } from '@/lib/dates';

import { isUuid } from '../../live/ids';
import {
  LINK_CANDIDATE_PAGE_SIZE,
  SOURCE_MEMORIES_LIMIT,
  isMemoryLinkSource,
  sourceDetailHref,
  type MemoryLinkSource,
} from '../constants';
import { decodeLinkCursor, encodeLinkCursor, linkCursorFilter } from '../cursor';
import type { LinkSourceSummary } from '../prefill';
import type {
  LinkCandidate,
  LinkCandidateResult,
  LinkedSourceView,
  MemoryLink,
  MemoryLinkResult,
  SourceDraftResult,
  SourceMemoriesResult,
  SourceMemorySummary,
} from '../types';

/**
 * 연결 조회(서버 전용).
 *
 * - 사용자 세션 + RLS로만 읽는다. 서비스 키는 이 경로에 없다(CONTRACTS.md 6).
 * - **조회 실패를 "연결 없음"으로 바꾸지 않는다.** 실패는 실패로 돌려주고 화면이 그 사실을 알린다.
 *   연결이 사라진 것처럼 보이면 사용자가 다시 연결해 중복 기록을 만든다.
 * - 원본 상세는 캘린더·위시 기능의 조회 함수를 **읽기 전용으로 재사용**한다. 한국 날짜 변환과
 *   권한 표시(`canEdit`·`ownerLabel`)를 다시 만들지 않는다(CAL-001 인수인계의 "후속 DATE-001 계약").
 * - 오류 원문(DB 메시지)은 화면·로그에 싣지 않는다.
 */

const LINK_FAILED = '연결 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
const CANDIDATES_FAILED = '연결할 수 있는 계획을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
const SIGNED_OUT = '로그인이 풀렸어요. 다시 로그인한 뒤 시도해 주세요.';

function logQueryFailure(operation: string, code: string | null | undefined): void {
  console.error(`memoryLinks.${operation} code=${(code ?? '').trim() || 'unknown'}`);
}

type MemberScope = { ok: true; spaceId: string; viewerId: string } | { ok: false; message: string };

async function memberScope(): Promise<MemberScope> {
  const context = await getSessionContext();
  if (context.status === 'member') {
    return { ok: true, spaceId: context.space.id, viewerId: context.user.id };
  }
  if (context.status === 'unconfigured') return { ok: false, message: LINK_FAILED };
  return { ok: false, message: SIGNED_OUT };
}

async function client(): Promise<SupabaseClient | null> {
  try {
    return await createSupabaseServerClient();
  } catch (error) {
    if (isSupabaseConfigError(error)) return null;
    throw error;
  }
}

function toMemoryLink(row: Record<string, unknown>): MemoryLink | null {
  const source = row.source;
  if (!isMemoryLinkSource(source)) return null;
  const sourceId = source === 'event' ? row.calendar_event_id : row.wish_item_id;
  if (typeof row.memory_id !== 'string' || typeof sourceId !== 'string') return null;
  if (typeof row.linked_by !== 'string' || typeof row.updated_at !== 'string') return null;
  return {
    memoryId: row.memory_id,
    source,
    sourceId,
    linkedBy: row.linked_by,
    updatedAt: row.updated_at,
  };
}

const LINK_COLUMNS = 'memory_id, source, calendar_event_id, wish_item_id, linked_by, updated_at';

/** 한 추억의 연결. 없으면 `none`, 조회가 실패하면 `error`다(둘을 구분한다). */
export async function getMemoryLink(memoryId: string): Promise<MemoryLinkResult> {
  if (!isUuid(memoryId)) return { status: 'none' };

  const scope = await memberScope();
  if (!scope.ok) return { status: 'error', message: scope.message };

  const supabase = await client();
  if (!supabase) return { status: 'error', message: LINK_FAILED };

  const { data, error } = await supabase
    .from('memory_links')
    .select(LINK_COLUMNS)
    .eq('memory_id', memoryId)
    .eq('space_id', scope.spaceId)
    .maybeSingle();

  if (error) {
    logQueryFailure('get', error.code);
    return { status: 'error', message: LINK_FAILED };
  }
  if (!data) return { status: 'none' };

  const link = toMemoryLink(data as Record<string, unknown>);
  if (!link) {
    logQueryFailure('get', 'shape');
    return { status: 'error', message: LINK_FAILED };
  }
  return { status: 'linked', link };
}

// ---------------------------------------------------------------------------
// 원본 상세 → 초안 재료
// ---------------------------------------------------------------------------

/**
 * 완료한 일정·위시의 사실만 뽑는다.
 *
 * 클라이언트가 보낸 제목·날짜·장소를 신뢰하지 않는다. 저장 직전에도 RPC가 상태·권한을 다시 확인한다.
 */
export async function loadLinkSourceSummary(
  source: MemoryLinkSource,
  sourceId: string,
): Promise<SourceDraftResult> {
  if (!isUuid(sourceId)) return { status: 'not_found' };

  if (source === 'event') {
    const result = await getCalendarEventDetail(sourceId);
    if (result.status === 'not_found') return { status: 'not_found' };
    if (result.status === 'error') return { status: 'error', message: result.message };

    const event = result.event;
    const summary: LinkSourceSummary = {
      source: 'event',
      id: event.id,
      title: event.title,
      // 캘린더에는 장소 열이 있다(CAL-001 설계 결정 1). 없으면 null 그대로 둔다.
      location: event.location,
      // 종일 일정이든 시간 일정이든 **시작일의 한국 날짜**가 그 일정의 날짜다.
      candidateDate: event.startDate,
      // 종일 일정의 종료일은 **포함**이다. 여러 날 일정 안내에만 쓰고 날짜로 고르지 않는다.
      endDate: event.allDay ? event.endDate : null,
      allDay: event.allDay,
      done: event.status === 'done',
    };
    return { status: 'ok', summary };
  }

  const result = await getWishDetail(sourceId);
  if (result.status === 'not_found') return { status: 'not_found' };
  if (result.status === 'error') return { status: 'error', message: result.message };

  const wish = result.wish;
  const summary: LinkSourceSummary = {
    source: 'wish',
    id: wish.id,
    title: wish.title,
    // 위시에는 장소 열이 **없다**. 추측하지 않고 빈칸으로 둔다.
    location: null,
    // 완료한 위시의 계획일은 비어 있거나 앞날일 수 있다. 초안 단계에서 판단한다.
    candidateDate: wish.plannedDate,
    endDate: null,
    allDay: false,
    done: wish.status === 'done',
  };
  return { status: 'ok', summary };
}

/** 상세 화면의 연결 카드. 원본을 읽지 못해도 연결 자체는 보여 준다. */
export async function loadLinkedSourceView(link: MemoryLink): Promise<LinkedSourceView> {
  const href = sourceDetailHref(link.source, link.sourceId);

  if (link.source === 'event') {
    const result = await getCalendarEventDetail(link.sourceId);
    if (result.status !== 'ok') return { link, href, detail: null };
    const event = result.event;
    return {
      link,
      href,
      detail: {
        title: event.title,
        summary: describeTiming(event),
        done: event.status === 'done',
      },
    };
  }

  const result = await getWishDetail(link.sourceId);
  if (result.status !== 'ok') return { link, href, detail: null };
  const wish = result.wish;
  const parts = [CATEGORY_LABELS[wish.category], WISH_STATUS_LABELS[wish.status]];
  if (wish.plannedDate && isCalendarDate(wish.plannedDate)) {
    parts.push(formatKoreanDate(wish.plannedDate));
  }
  return {
    link,
    href,
    detail: { title: wish.title, summary: parts.join(' · '), done: wish.status === 'done' },
  };
}

// ---------------------------------------------------------------------------
// 연결 후보 목록 (완료한 일정·위시, 커서 페이지네이션)
// ---------------------------------------------------------------------------

/** 후보마다 이미 연결된 추억 수를 센다. 연결을 막지는 않고 화면에 알리기만 한다. */
async function countLinkedMemories(
  supabase: SupabaseClient,
  spaceId: string,
  source: MemoryLinkSource,
  ids: string[],
): Promise<Map<string, number> | null> {
  if (ids.length === 0) return new Map();
  const column = source === 'event' ? 'calendar_event_id' : 'wish_item_id';
  const { data, error } = await supabase
    .from('memory_links')
    .select(column)
    .eq('space_id', spaceId)
    .in(column, ids);
  if (error) return null;

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const id = row[column];
    if (typeof id !== 'string') continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function listLinkCandidates(
  source: MemoryLinkSource,
  rawCursor: string | null = null,
  pageSize: number = LINK_CANDIDATE_PAGE_SIZE,
): Promise<LinkCandidateResult> {
  const scope = await memberScope();
  if (!scope.ok) return { ok: false, message: scope.message };

  const supabase = await client();
  if (!supabase) return { ok: false, message: CANDIDATES_FAILED };

  const cursor = decodeLinkCursor(rawCursor);
  // 형식이 어긋난 커서는 첫 페이지로 되돌리지 않고 빈 결과로 끝낸다(같은 항목 중복 표시 방지).
  if (rawCursor !== null && rawCursor !== '' && cursor === null) {
    return { ok: true, items: [], nextCursor: null };
  }

  const table = source === 'event' ? 'calendar_events' : 'wish_items';
  const orderColumn = source === 'event' ? 'starts_at' : 'created_at';
  const columns =
    source === 'event'
      ? 'id, title, location, starts_at, all_day'
      : 'id, title, category, planned_date, created_at';

  let query = supabase
    .from(table)
    .select(columns)
    .eq('space_id', scope.spaceId)
    // 완료한 계획만 연결할 수 있다(DB도 다시 검사한다).
    .eq('status', 'done');
  if (cursor) query = query.or(linkCursorFilter(orderColumn, cursor));

  const { data, error } = await query
    .order(orderColumn, { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1);

  if (error || !Array.isArray(data)) {
    logQueryFailure('candidates', error?.code);
    return { ok: false, message: CANDIDATES_FAILED };
  }

  const rows = data as unknown as Record<string, unknown>[];
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  const ids: string[] = [];
  for (const row of page) {
    if (typeof row.id !== 'string') {
      logQueryFailure('candidates', 'shape');
      return { ok: false, message: CANDIDATES_FAILED };
    }
    ids.push(row.id);
  }

  const counts = await countLinkedMemories(supabase, scope.spaceId, source, ids);
  if (!counts) {
    logQueryFailure('candidates', 'links');
    return { ok: false, message: CANDIDATES_FAILED };
  }

  const items: LinkCandidate[] = [];
  let lastOrderValue: string | null = null;
  for (const row of page) {
    const id = String(row.id);
    const title = row.title;
    if (typeof title !== 'string') {
      logQueryFailure('candidates', 'shape');
      return { ok: false, message: CANDIDATES_FAILED };
    }

    if (source === 'event') {
      const startsAt = row.starts_at;
      if (typeof startsAt !== 'string') {
        logQueryFailure('candidates', 'shape');
        return { ok: false, message: CANDIDATES_FAILED };
      }
      const moment = toSeoulMoment(startsAt);
      lastOrderValue = startsAt;
      items.push({
        source,
        id,
        title,
        date: moment?.date ?? null,
        detail: typeof row.location === 'string' && row.location !== '' ? row.location : null,
        linkedMemoryCount: counts.get(id) ?? 0,
      });
      continue;
    }

    const createdAt = row.created_at;
    if (typeof createdAt !== 'string') {
      logQueryFailure('candidates', 'shape');
      return { ok: false, message: CANDIDATES_FAILED };
    }
    lastOrderValue = createdAt;
    const category = row.category;
    const plannedDate = row.planned_date;
    items.push({
      source,
      id,
      title,
      date: typeof plannedDate === 'string' && isCalendarDate(plannedDate) ? plannedDate : null,
      detail:
        typeof category === 'string' && category in CATEGORY_LABELS
          ? CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]
          : null,
      linkedMemoryCount: counts.get(id) ?? 0,
    });
  }

  const last = items.at(-1);
  const nextCursor =
    hasMore && last && lastOrderValue !== null
      ? encodeLinkCursor({ value: lastOrderValue, id: last.id })
      : null;

  return { ok: true, items, nextCursor };
}

/**
 * 한 원본(완료한 일정·해낸 위시)에 연결된 데이트 기록 목록.
 *
 * 위시·캘린더 상세 화면이 "이 계획으로 남긴 기록"을 보여 주고, 원본 삭제가 거부되는 이유
 * (`GF409 has_memories`)를 사용자가 눈으로 확인할 수 있게 한다.
 *
 * - 사용자 세션 + RLS로만 읽는다. 다른 공간의 연결은 애초에 보이지 않는다.
 * - 조회 실패는 빈 목록이 아니라 실패로 돌려준다.
 * - 최신 기록이 위로 온다(추억 목록과 같은 정렬: 날짜 DESC, id DESC).
 */
export async function listSourceMemories(
  source: MemoryLinkSource,
  sourceId: string,
): Promise<SourceMemoriesResult> {
  if (!isMemoryLinkSource(source) || !isUuid(sourceId)) {
    return { ok: true, items: [], truncated: false };
  }

  const scope = await memberScope();
  if (!scope.ok) return { ok: false, message: scope.message };

  const supabase = await client();
  if (!supabase) return { ok: false, message: LINK_FAILED };

  // 세 번 나눠 읽는다. `memory_links`→`memories`, `memories`→`memory_photos`는 모두
  // (id, space_id) 복합 FK라 PostgREST 중첩 select의 관계 해석이 보장되지 않는다.
  // MEM-001의 조회도 같은 이유로 따로 읽어 JS에서 합친다(`server/queries.ts`).
  const column = source === 'event' ? 'calendar_event_id' : 'wish_item_id';
  const links = await supabase
    .from('memory_links')
    .select('memory_id')
    .eq('space_id', scope.spaceId)
    .eq(column, sourceId)
    // 상한 + 1을 읽어 "더 있는지"를 판단한다. 조용히 자르지 않는다.
    .limit(SOURCE_MEMORIES_LIMIT + 1);
  if (links.error) {
    logQueryFailure('listSourceMemories.links', links.error.code);
    return { ok: false, message: LINK_FAILED };
  }

  const memoryIds: string[] = [];
  for (const row of (links.data ?? []) as Record<string, unknown>[]) {
    const id = row.memory_id;
    if (typeof id === 'string' && isUuid(id)) memoryIds.push(id);
  }
  if (memoryIds.length === 0) return { ok: true, items: [], truncated: false };
  const truncated = memoryIds.length > SOURCE_MEMORIES_LIMIT;
  const pageIds = truncated ? memoryIds.slice(0, SOURCE_MEMORIES_LIMIT) : memoryIds;

  // RLS가 같은 공간만 돌려준다. 공간 조건을 한 번 더 걸어 의도를 드러낸다.
  const memories = await supabase
    .from('memories')
    .select('id, title, memory_date')
    .eq('space_id', scope.spaceId)
    .in('id', pageIds);
  if (memories.error) {
    logQueryFailure('listSourceMemories.memories', memories.error.code);
    return { ok: false, message: LINK_FAILED };
  }

  const photos = await supabase.from('memory_photos').select('memory_id').in('memory_id', pageIds);
  if (photos.error) {
    logQueryFailure('listSourceMemories.photos', photos.error.code);
    return { ok: false, message: LINK_FAILED };
  }

  const photoCounts = new Map<string, number>();
  for (const row of (photos.data ?? []) as Record<string, unknown>[]) {
    const id = row.memory_id;
    if (typeof id !== 'string') continue;
    photoCounts.set(id, (photoCounts.get(id) ?? 0) + 1);
  }

  const items: SourceMemorySummary[] = [];
  for (const row of (memories.data ?? []) as Record<string, unknown>[]) {
    const memoryId = row.id;
    const title = row.title;
    const memoryDate = row.memory_date;
    if (typeof memoryId !== 'string' || typeof title !== 'string') continue;
    if (typeof memoryDate !== 'string' || !isCalendarDate(memoryDate)) continue;
    items.push({ memoryId, title, memoryDate, photoCount: photoCounts.get(memoryId) ?? 0 });
  }

  // 추억 목록과 같은 정렬(날짜 DESC, id DESC).
  items.sort((a, b) =>
    a.memoryDate === b.memoryDate
      ? b.memoryId.localeCompare(a.memoryId)
      : b.memoryDate.localeCompare(a.memoryDate),
  );

  return { ok: true, items, truncated };
}
