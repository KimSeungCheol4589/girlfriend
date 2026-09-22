import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';

import { LIVE_MEMORY_PAGE_SIZE, MEMORY_FILTER_OPTIONS_SCAN_LIMIT } from '../live/constants';
import { isUuid } from '../live/ids';
import {
  collectLiveFilterOptions,
  cursorOrFilter,
  monthRange,
  parseCursor,
  splitPage,
  toPgArrayLiteral,
  toTagFilter,
} from '../live/list-query';
import type { LiveFilterOptions, LiveMemory, LiveMemoryPage } from '../live/types';

/**
 * 추억 조회. **사용자 세션 + RLS만** 쓴다(service_role 없음).
 *
 * - 요청마다 Auth 서버로 사용자를 다시 확인한다(`getVerifiedUser`). 쿠키 값을 그대로 믿지 않는다.
 * - 공간 조건은 RLS(`space_id = app.current_space_id()`)가 강제한다. 다른 공간·없는 ID는 똑같이 "없음"이다.
 * - 조회 실패를 빈 목록으로 바꾸지 않는다. 화면이 실패와 재시도를 보여 준다.
 */

export type QueryFailureCode = 'UNAUTHENTICATED' | 'CONFIG_ERROR' | 'RETRYABLE_ERROR';
export type QueryResult<T> = { ok: true; data: T } | { ok: false; code: QueryFailureCode };

type MemoryRow = {
  id: string;
  title: string;
  body: string;
  memory_date: string;
  location: string | null;
  tags: string[] | null;
  is_pinned: boolean;
  version: number;
  author_id: string;
  updated_at: string;
};

type PhotoRow = { memory_id: string; asset_id: string; sort_order: number };

const MEMORY_COLUMNS =
  'id, title, body, memory_date, location, tags, is_pinned, version, author_id, updated_at';

async function verifiedClient(): Promise<{ ok: true; client: SupabaseClient } | { ok: false; code: QueryFailureCode }> {
  let client: SupabaseClient;
  try {
    client = await createSupabaseServerClient();
  } catch (error) {
    if (isSupabaseConfigError(error)) return { ok: false, code: 'CONFIG_ERROR' };
    throw error;
  }
  const user = await getVerifiedUser(client);
  if (!user) return { ok: false, code: 'UNAUTHENTICATED' };
  return { ok: true, client };
}

function toLiveMemory(row: MemoryRow, photos: PhotoRow[]): LiveMemory {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? '',
    memoryDate: row.memory_date,
    location: row.location,
    tags: row.tags ?? [],
    isPinned: row.is_pinned,
    version: row.version,
    authorId: row.author_id,
    updatedAt: row.updated_at,
    photos: photos
      .filter((photo) => photo.memory_id === row.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((photo) => ({ assetId: photo.asset_id, sortOrder: photo.sort_order })),
  };
}

/** 기록 행에 사진 순서를 붙인다. 사진 조회가 실패하면 전체를 실패로 본다(사진 없는 기록으로 속이지 않는다). */
async function withPhotos(client: SupabaseClient, rows: MemoryRow[]): Promise<LiveMemory[] | null> {
  if (rows.length === 0) return [];
  const { data, error } = await client
    .from('memory_photos')
    .select('memory_id, asset_id, sort_order')
    .in(
      'memory_id',
      rows.map((row) => row.id),
    )
    .order('sort_order', { ascending: true });
  if (error) return null;
  const photos = (data ?? []) as PhotoRow[];
  return rows.map((row) => toLiveMemory(row, photos));
}

export type ListRequest = { month: string | null; tag: string | null; cursor: string | null };

export async function listMemoriesPage(request: ListRequest): Promise<QueryResult<LiveMemoryPage>> {
  const client = await verifiedClient();
  if (!client.ok) return client;

  const tagFilter = toTagFilter(request.tag);
  if (tagFilter.kind === 'impossible') return { ok: true, data: { items: [], nextCursor: null } };

  let query = client.client
    .from('memories')
    .select(MEMORY_COLUMNS)
    .order('memory_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(LIVE_MEMORY_PAGE_SIZE + 1);

  if (request.month) {
    const range = monthRange(request.month);
    if (range) query = query.gte('memory_date', range.from).lt('memory_date', range.to);
  }
  if (tagFilter.kind === 'tag') {
    query = query.filter('tags', 'cs', toPgArrayLiteral([tagFilter.value]));
  }
  if (request.cursor !== null) {
    const cursor = parseCursor(request.cursor);
    // 형식이 틀린 커서는 첫 페이지로 되돌리지 않는다. 중복 표시를 막기 위해 빈 결과로 끝낸다.
    if (!cursor) return { ok: true, data: { items: [], nextCursor: null } };
    query = query.or(cursorOrFilter(cursor));
  }

  const { data, error } = await query;
  if (error) return { ok: false, code: 'RETRYABLE_ERROR' };

  const memories = await withPhotos(client.client, (data ?? []) as MemoryRow[]);
  if (!memories) return { ok: false, code: 'RETRYABLE_ERROR' };

  const page = splitPage(memories, LIVE_MEMORY_PAGE_SIZE);
  return { ok: true, data: page };
}

export async function listFilterOptions(): Promise<QueryResult<LiveFilterOptions>> {
  const client = await verifiedClient();
  if (!client.ok) return client;

  const { data, error } = await client.client
    .from('memories')
    .select('memory_date, tags')
    .order('memory_date', { ascending: false })
    .limit(MEMORY_FILTER_OPTIONS_SCAN_LIMIT);
  if (error) return { ok: false, code: 'RETRYABLE_ERROR' };

  const rows = ((data ?? []) as { memory_date: string; tags: string[] | null }[]).map((row) => ({
    memoryDate: row.memory_date,
    tags: row.tags ?? [],
  }));
  return { ok: true, data: collectLiveFilterOptions(rows) };
}

/** 한 기록. 없거나 다른 공간이면 `null`(호출자는 같은 404를 그린다). */
export async function getMemoryById(id: string): Promise<QueryResult<LiveMemory | null>> {
  if (!isUuid(id)) return { ok: true, data: null };

  const client = await verifiedClient();
  if (!client.ok) return client;

  const { data, error } = await client.client
    .from('memories')
    .select(MEMORY_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    // 잘못된 형식 등 조회 권한 오류는 존재 여부를 알리지 않도록 "없음"으로 통일한다.
    if (error.code === '42501' || error.code === '22P02') return { ok: true, data: null };
    return { ok: false, code: 'RETRYABLE_ERROR' };
  }
  if (!data) return { ok: true, data: null };

  const memories = await withPhotos(client.client, [data as MemoryRow]);
  if (!memories) return { ok: false, code: 'RETRYABLE_ERROR' };
  return { ok: true, data: memories[0] ?? null };
}

export type HomeMemorySummary = { pinned: LiveMemory[]; recent: LiveMemory[] };

/** 홈의 고정 추억(최대 3개)과 최근 추억(고정한 것 제외 3개). */
export async function getHomeMemorySummary(): Promise<QueryResult<HomeMemorySummary>> {
  const client = await verifiedClient();
  if (!client.ok) return client;

  const [pinnedResult, recentResult] = await Promise.all([
    client.client
      .from('memories')
      .select(MEMORY_COLUMNS)
      .eq('is_pinned', true)
      .order('memory_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(3),
    client.client
      .from('memories')
      .select(MEMORY_COLUMNS)
      .order('memory_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(6),
  ]);
  if (pinnedResult.error || recentResult.error) return { ok: false, code: 'RETRYABLE_ERROR' };

  const pinnedRows = (pinnedResult.data ?? []) as MemoryRow[];
  const pinnedIds = new Set(pinnedRows.map((row) => row.id));
  const recentRows = ((recentResult.data ?? []) as MemoryRow[])
    .filter((row) => !pinnedIds.has(row.id))
    .slice(0, 3);

  const all = await withPhotos(client.client, [...pinnedRows, ...recentRows]);
  if (!all) return { ok: false, code: 'RETRYABLE_ERROR' };

  return {
    ok: true,
    data: {
      pinned: all.slice(0, pinnedRows.length),
      recent: all.slice(pinnedRows.length),
    },
  };
}
