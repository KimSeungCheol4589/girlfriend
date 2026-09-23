import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getSessionContext } from '@/features/auth/queries';
import { listMemoriesPage } from '@/features/memories/server/queries';
import { DEFAULT_ACCENT_COLOR, type ThemeKey } from '@/lib/contracts';
import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isHexColor, isThemeKey } from '@/lib/theme';

import { PINNED_CANDIDATE_LIMIT } from '../constants';
import { mergePinCandidates, toPinCandidate } from '../pin';
import { parseHomeSections } from '../sections';
import type { PinCandidatePage, QueryFailureCode, QueryResult, SavedCustomization } from '../types';

/**
 * 꾸미기 조회. **사용자 세션 + RLS만** 쓴다(service_role 없음).
 *
 * - 공간 조건은 RLS가 강제한다. 앱이 spaceId를 조건으로 넣지 않아도 다른 공간은 보이지 않는다.
 * - 조회 실패를 기본값으로 바꾸지 않는다. 화면이 실패와 재시도를 보여 준다.
 *   (기본값으로 덮으면 사용자가 상대의 저장 설정을 모른 채 덮어쓸 수 있다.)
 */

type SettingsRow = {
  theme_key: string;
  accent_color: string;
  cover_asset_id: string | null;
  home_sections: unknown;
  version: number;
};

type CoverAssetRow = { id: string; uploader_id: string; state: string; purpose: string };

async function memberClient(): Promise<
  { ok: true; client: SupabaseClient; userId: string; spaceId: string } | { ok: false; code: QueryFailureCode }
> {
  const context = await getSessionContext();
  if (context.status === 'unconfigured') return { ok: false, code: 'CONFIG_ERROR' };
  if (context.status === 'anonymous') return { ok: false, code: 'UNAUTHENTICATED' };
  // 공간이 없으면 꾸미기 화면 자체가 열리지 않는다(진입 검사가 /onboarding으로 보낸다).
  if (context.status === 'no_space') return { ok: false, code: 'UNAUTHENTICATED' };

  try {
    return { ok: true, client: await createSupabaseServerClient(), userId: context.user.id, spaceId: context.space.id };
  } catch (error) {
    if (isSupabaseConfigError(error)) return { ok: false, code: 'CONFIG_ERROR' };
    throw error;
  }
}

/**
 * 저장된 공유 설정 한 벌.
 *
 * 커버는 `space_settings.cover_asset_id`를 그대로 돌려준다. 그 값을 붙인 `save_customization`이
 * 이미 같은 공간·`cover`·`ready`·업로더를 검사했기 때문이다. 실제 사진을 내려받을 수 있는지는
 * 인증 경로가 세션·Storage 정책으로 다시 판단하고, 불러오지 못하면 화면이 조용히 배경만 보여 준다.
 */
export async function getSavedCustomization(): Promise<QueryResult<SavedCustomization>> {
  const session = await memberClient();
  if (!session.ok) return session;

  const { data, error } = await session.client
    .from('space_settings')
    .select('theme_key, accent_color, cover_asset_id, home_sections, version')
    .eq('space_id', session.spaceId)
    .maybeSingle();
  if (error) return { ok: false, code: 'RETRYABLE_ERROR' };
  // 공간을 만들 때 설정 행도 같은 트랜잭션에서 생긴다(CONTRACTS.md 1). 행이 없으면
  // 기본값으로 덮지 않고 실패로 알린다. expectedVersion을 지어내면 상대 저장을 덮을 수 있다.
  if (!data) return { ok: false, code: 'RETRYABLE_ERROR' };

  const row = data as SettingsRow;

  return {
    ok: true,
    data: {
      themeKey: isThemeKey(row.theme_key) ? (row.theme_key as ThemeKey) : 'cream',
      accentColor: isHexColor(row.accent_color) ? row.accent_color.toLowerCase() : DEFAULT_ACCENT_COLOR.toLowerCase(),
      // 설정에 적힌 값을 그대로 쓴다. `save_customization`이 붙일 때 이미 같은 공간·`cover`·`ready`·
      // 업로더를 검사했으므로, 값이 있으면 실제로 붙어 있는 커버다. 사진을 실제로 내려받을 수
      // 있는지는 인증 경로(`/customize/cover/[assetId]`)가 세션·Storage 정책으로 다시 판단한다.
      // 여기서 파일 메타데이터를 한 번 더 읽어 걸러 내면, 그 조회가 막혔을 때 저장된 커버가
      // 조용히 사라진 것처럼 보인다.
      coverAssetId: row.cover_asset_id,
      sections: parseHomeSections(row.home_sections),
      version: row.version,
      coverUploadedByMe: await readCoverUploader(session.client, row.cover_asset_id, session.userId),
    },
  };
}

/**
 * "이 커버를 내가 올렸는지"는 **안내 문구에만** 쓰는 힌트다.
 * 읽지 못하면 `null`(모름)을 돌려주고, 화면은 모르는 것을 아는 척하지 않는다.
 * 권한 판단 자체는 DB가 한다(새 커버는 올린 사람만 지정할 수 있다).
 */
async function readCoverUploader(
  client: SupabaseClient,
  coverAssetId: string | null,
  userId: string,
): Promise<boolean | null> {
  if (!coverAssetId) return null;
  const { data, error } = await client
    .from('assets')
    .select('id, uploader_id, state, purpose')
    .eq('id', coverAssetId)
    .maybeSingle();
  if (error) return null;

  const asset = data as CoverAssetRow | null;
  if (!asset) return null;
  return asset.uploader_id === userId;
}

/**
 * 고정 후보 첫 화면.
 *
 * 고정된 기록은 **따로 모두** 읽어 앞에 둔다. 최근 20개 안에 없다는 이유로 이미 고정한 기록이
 * 목록에서 사라지면 해제할 방법이 없어진다. 나머지는 추억 목록과 같은 정렬·같은 커서를 쓴다.
 */
export async function getPinCandidates(): Promise<QueryResult<PinCandidatePage>> {
  const session = await memberClient();
  if (!session.ok) return session;

  const recent = await listMemoriesPage({ month: null, tag: null, cursor: null });
  if (!recent.ok) return { ok: false, code: recent.code };

  const { data, error } = await session.client
    .from('memories')
    .select('id, title, body, memory_date, location, tags, is_pinned, version, author_id, updated_at')
    .eq('is_pinned', true)
    .order('memory_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(PINNED_CANDIDATE_LIMIT);
  if (error) return { ok: false, code: 'RETRYABLE_ERROR' };

  const pinnedRows = (data ?? []) as {
    id: string;
    title: string;
    body: string | null;
    memory_date: string;
    location: string | null;
    tags: string[] | null;
    is_pinned: boolean;
    version: number;
    author_id: string;
    updated_at: string;
  }[];

  // 고정 저장에는 사진 순서도 그대로 필요하다(스냅샷을 그대로 되돌려 보내는 방식이라 빠지면 사진이 떨어진다).
  const photoIds = pinnedRows.map((row) => row.id);
  let photos: { memory_id: string; asset_id: string; sort_order: number }[] = [];
  if (photoIds.length > 0) {
    const result = await session.client
      .from('memory_photos')
      .select('memory_id, asset_id, sort_order')
      .in('memory_id', photoIds)
      .order('sort_order', { ascending: true });
    if (result.error) return { ok: false, code: 'RETRYABLE_ERROR' };
    photos = (result.data ?? []) as typeof photos;
  }

  const pinned = pinnedRows.map((row) =>
    toPinCandidate({
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
    }),
  );

  return {
    ok: true,
    data: {
      items: mergePinCandidates(pinned, recent.data.items.map(toPinCandidate)),
      nextCursor: recent.data.nextCursor,
    },
  };
}
