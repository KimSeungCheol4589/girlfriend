import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { finalizeOwnedMemoryPhoto, type FinalizeDeps } from '@/features/memories/server/finalize-core';
import { verifyMemoryPhoto } from '@/features/memories/server/image-verify';

import {
  THEME_ACCOUNTS_PATH,
  loadThemeAccounts,
  parseErrorDetails,
  readThemeTestEnv,
  rpc,
  serviceSelect,
  signIn,
  storageUpload,
  type ThemeTestEnv,
} from '../support/local-api';

/**
 * 커버 확정의 용도 격리 — 실제 로컬 Supabase 검증(합성 계정 theme-e2e).
 *
 * 커버와 추억 사진은 같은 버킷·같은 파이프라인을 쓴다. 이 테스트는 **용도를 잘못 넘기면
 * 확정되지 않는다**는 것을 실제 DB·Storage로 확인한다. 상태가 바뀌지 않는 것까지 본다.
 */

const env = readThemeTestEnv();
const ready = env !== null && env.serviceKey !== null && existsSync(THEME_ACCOUNTS_PATH);
const BUCKET = 'space-assets';

describe.skipIf(!ready)('커버 확정은 용도를 섞지 않는다', () => {
  const live = env as ThemeTestEnv;
  const saved: Record<string, string | undefined> = {};
  let token = '';
  let deps: FinalizeDeps;

  async function webp(seed: number): Promise<Buffer> {
    return sharp({ create: { width: 240, height: 135, channels: 3, background: { r: seed % 255, g: 80, b: 140 } } })
      .webp({ quality: 80 })
      .toBuffer();
  }

  async function prepareAndUpload(purpose: 'memory' | 'cover', bytes: Buffer) {
    const prepared = await rpc<{ assetId: string; objectPath: string }>(live, token, 'prepare_upload', {
      p_purpose: purpose,
      p_mime_type: 'image/webp',
      p_bytes: bytes.byteLength,
      p_request_id: randomUUID(),
    });
    if (!prepared.data) throw new Error(`prepare_upload 실패 HTTP ${prepared.status}`);
    expect(await storageUpload(live, token, BUCKET, prepared.data.objectPath, bytes, 'image/webp')).toBe(200);
    return prepared.data;
  }

  async function state(assetId: string): Promise<string | null> {
    const result = await serviceSelect<{ state: string }[]>(live, 'assets', `select=state&id=eq.${assetId}`);
    return result.data?.[0]?.state ?? null;
  }

  beforeAll(async () => {
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'MEM_SUPABASE_SERVICE_ROLE_KEY']) {
      saved[key] = process.env[key];
    }
    // 정리(removeDeletingObjects)가 앱과 같은 방식으로 설정을 읽는다.
    process.env.NEXT_PUBLIC_SUPABASE_URL = live.url;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = live.anonKey;
    process.env.MEM_SUPABASE_SERVICE_ROLE_KEY = live.serviceKey ?? '';

    const accounts = loadThemeAccounts();
    token = await signIn(live, accounts.a);

    const members = await serviceSelect<{ space_id: string }[]>(
      live,
      'space_members',
      `select=space_id&user_id=eq.${accounts.a.userId}`,
    );
    const spaceId = members.data?.[0]?.space_id ?? '';
    expect(spaceId.length > 0).toBe(true);

    deps = {
      userClient: createClient(live.url, live.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      }),
      userId: accounts.a.userId ?? '',
      spaceId,
      service: createClient(live.url, live.serviceKey ?? '', {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }) as SupabaseClient,
      storageRequest: (path: string) => ({
        url: `${live.url}/storage/v1/${path}`,
        headers: { apikey: live.serviceKey ?? '', Authorization: `Bearer ${live.serviceKey ?? ''}` },
      }),
      verify: verifyMemoryPhoto,
    };
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('커버 파일은 cover로 확정된다', async () => {
    const asset = await prepareAndUpload('cover', await webp(1));
    expect(await finalizeOwnedMemoryPhoto(deps, asset.assetId, 'cover')).toEqual({
      ok: true,
      data: { assetId: asset.assetId },
    });
    expect(await state(asset.assetId)).toBe('ready');
    await rpc(live, token, 'discard_upload', { p_asset_id: asset.assetId, p_request_id: randomUUID() });
  });

  it('추억 파일을 커버로 확정하려 하면 거부하고 상태를 바꾸지 않는다', async () => {
    const asset = await prepareAndUpload('memory', await webp(2));
    const result = await finalizeOwnedMemoryPhoto(deps, asset.assetId, 'cover');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
    expect(await state(asset.assetId)).toBe('pending');

    // 같은 파일을 제 용도로 확정하는 것은 그대로 된다(기존 추억 동작 보존).
    expect((await finalizeOwnedMemoryPhoto(deps, asset.assetId, 'memory')).ok).toBe(true);
    expect(await state(asset.assetId)).toBe('ready');

    // **ready**가 된 뒤에도 용도는 섞이지 않는다. 확정기의 "이미 ready면 성공" 지름길이
    // 용도 검사보다 먼저 동작하면 여기서 통과해 버린다.
    const readyMismatch = await finalizeOwnedMemoryPhoto(deps, asset.assetId, 'cover');
    expect(readyMismatch.ok).toBe(false);
    if (!readyMismatch.ok) expect(readyMismatch.code).toBe('NOT_FOUND');

    // DB도 ready인 추억 파일을 커버로 붙이지 않는다.
    // 내 파일이므로 존재를 숨길 이유가 없어 **검증 실패(GF422)** 이고, 힌트는 용도 불일치다.
    // (남의 파일·다른 공간이면 그 앞의 검사에서 GF404로 통일된다.)
    const settings = await serviceSelect<
      {
        theme_key: string;
        accent_color: string;
        home_sections: unknown;
        version: number;
        cover_asset_id: string | null;
      }[]
    >(
      live,
      'space_settings',
      `select=theme_key,accent_color,home_sections,version,cover_asset_id&space_id=eq.${deps.spaceId}`,
    );
    const row = settings.data?.[0];
    const rejected = await rpc(live, token, 'save_customization', {
      p_theme_key: row?.theme_key ?? 'cream',
      p_accent_color: row?.accent_color ?? '#8b435a',
      p_cover_asset_id: asset.assetId,
      p_home_sections: row?.home_sections ?? [],
      p_expected_version: row?.version ?? 0,
      p_request_id: randomUUID(),
    });
    expect(rejected.code, 'ready 상태의 추억 파일을 커버로 지정').toBe('GF422');
    expect(parseErrorDetails(rejected.details), '용도 불일치 힌트').toMatchObject({ coverAssetId: 'purpose' });
    expect(rejected.data).toBeNull();

    // 거부된 저장은 설정을 바꾸지 않는다(버전·커버 모두 그대로).
    const afterReject = await serviceSelect<{ version: number; cover_asset_id: string | null }[]>(
      live,
      'space_settings',
      `select=version,cover_asset_id&space_id=eq.${deps.spaceId}`,
    );
    expect(afterReject.data?.[0]?.version).toBe(row?.version);
    expect(afterReject.data?.[0]?.cover_asset_id ?? null).toBe(row?.cover_asset_id ?? null);

    await rpc(live, token, 'discard_upload', { p_asset_id: asset.assetId, p_request_id: randomUUID() });
  });

  it('커버 파일을 추억 사진으로 확정하려 하면 거부한다', async () => {
    const asset = await prepareAndUpload('cover', await webp(3));
    const result = await finalizeOwnedMemoryPhoto(deps, asset.assetId, 'memory');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
    expect(await state(asset.assetId)).toBe('pending');
    await rpc(live, token, 'discard_upload', { p_asset_id: asset.assetId, p_request_id: randomUUID() });
  });

  it('확정한 커버는 save_customization으로만 설정에 붙는다', async () => {
    const asset = await prepareAndUpload('cover', await webp(4));
    expect((await finalizeOwnedMemoryPhoto(deps, asset.assetId, 'cover')).ok).toBe(true);

    const settings = await serviceSelect<{ theme_key: string; accent_color: string; home_sections: unknown; version: number }[]>(
      live,
      'space_settings',
      `select=theme_key,accent_color,home_sections,version&space_id=eq.${deps.spaceId}`,
    );
    const row = settings.data?.[0];
    expect(row).toBeTruthy();

    const result = await rpc<{ coverAssetId: string }>(live, token, 'save_customization', {
      p_theme_key: row?.theme_key ?? 'cream',
      p_accent_color: row?.accent_color ?? '#8b435a',
      p_cover_asset_id: asset.assetId,
      p_home_sections: row?.home_sections ?? [],
      p_expected_version: row?.version ?? 0,
      p_request_id: randomUUID(),
    });
    expect(result.status).toBe(200);
    expect(result.data?.coverAssetId).toBe(asset.assetId);

    // 붙은 커버는 취소로 사라지지 않는다.
    const discard = await rpc(live, token, 'discard_upload', {
      p_asset_id: asset.assetId,
      p_request_id: randomUUID(),
    });
    // CONTRACTS.md 2: 이미 첨부된 asset의 취소는 GF409다(PostgREST는 사용자 정의 SQLSTATE를 400으로 낸다).
    expect(discard.code, '첨부된 커버 취소').toBe('GF409');
    expect(await state(asset.assetId)).toBe('ready');

    // 정리: 커버를 떼어 낸다(다음 실행이 깨끗한 상태에서 시작하도록).
    const after = await serviceSelect<{ version: number }[]>(
      live,
      'space_settings',
      `select=version&space_id=eq.${deps.spaceId}`,
    );
    await rpc(live, token, 'save_customization', {
      p_theme_key: row?.theme_key ?? 'cream',
      p_accent_color: row?.accent_color ?? '#8b435a',
      p_cover_asset_id: null,
      p_home_sections: row?.home_sections ?? [],
      p_expected_version: after.data?.[0]?.version ?? 0,
      p_request_id: randomUUID(),
    });
  });
});
