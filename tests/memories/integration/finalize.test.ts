import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { finalizeOwnedMemoryPhoto, type FinalizeDeps } from '@/features/memories/server/finalize-core';
import { verifyMemoryPhoto } from '@/features/memories/server/image-verify';

import {
  MEM_ACCOUNTS_PATH,
  isMissingObjectStatus,
  loadMemAccounts,
  readMemTestEnv,
  rpc,
  serviceDownload,
  serviceSelect,
  signIn,
  storageUpload,
  withExifOrientation6,
  type MemTestEnv,
} from '../support/local-api';

/**
 * 업로드 확정 프로토콜의 실제 백엔드 검증(로컬 Supabase, 합성 계정 mem-e2e).
 *
 * 앱의 확정 핵심(finalizeOwnedMemoryPhoto)을 실제 사용자 세션 클라이언트·service 클라이언트·sharp 검증기로 부른다.
 * 핵심 불변식: **어떤 재시도·동시 호출에서도 Storage 객체 바이트가 바뀌지 않는다.**
 * "RPC 중단" 시나리오 하나만 service.rpc를 한 번 실패시키는 래퍼를 쓴다(그 외 호출은 모두 실제).
 */

const env = readMemTestEnv();
const ready = env !== null && env.serviceKey !== null && existsSync(MEM_ACCOUNTS_PATH);
const BUCKET = 'space-assets';

type Asset = { assetId: string; objectPath: string };
type AssetRow = { state: string; bytes: number | null; width: number | null; height: number | null; ready_at: string | null };

function sha(bytes: Uint8Array | null): string {
  return createHash('sha256').update(bytes ?? new Uint8Array()).digest('hex');
}

describe.skipIf(!ready)('확정 프로토콜 — 읽기 전용 검증, 객체 불변', () => {
  const live = env as MemTestEnv;
  const saved: Record<string, string | undefined> = {};
  let tokenA = '';
  let tokenB = '';
  let depsA: FinalizeDeps;
  let depsB: FinalizeDeps;
  let service: SupabaseClient;

  function userClient(token: string): SupabaseClient {
    return createClient(live.url, live.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }

  const storageRequest = (path: string) => ({
    url: `${live.url}/storage/v1/${path}`,
    headers: { apikey: live.serviceKey ?? '', Authorization: `Bearer ${live.serviceKey ?? ''}` },
  });

  async function webp(width: number, height: number, seed: number): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: seed % 255, g: 90, b: 160 } } })
      .webp({ quality: 80 })
      .toBuffer();
  }

  async function prepare(token: string, mime: string, bytes: number): Promise<Asset> {
    const result = await rpc<Asset & { bucket: string }>(live, token, 'prepare_upload', {
      p_purpose: 'memory',
      p_mime_type: mime,
      p_bytes: bytes,
      p_request_id: randomUUID(),
    });
    if (!result.data) throw new Error(`prepare_upload 실패 HTTP ${result.status}`);
    return { assetId: result.data.assetId, objectPath: result.data.objectPath };
  }

  async function prepareAndUpload(token: string, bytes: Buffer, mime: string): Promise<Asset> {
    const asset = await prepare(token, mime, bytes.byteLength);
    expect(await storageUpload(live, token, BUCKET, asset.objectPath, bytes, mime)).toBe(200);
    return asset;
  }

  async function row(assetId: string): Promise<AssetRow | null> {
    const result = await serviceSelect<AssetRow[]>(live, 'assets', `select=state,bytes,width,height,ready_at&id=eq.${assetId}`);
    return result.data?.[0] ?? null;
  }

  async function objectHash(asset: Asset): Promise<string | null> {
    const download = await serviceDownload(live, BUCKET, asset.objectPath);
    return download.status === 200 ? sha(download.bytes) : null;
  }

  beforeAll(async () => {
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'MEM_SUPABASE_SERVICE_ROLE_KEY']) {
      saved[key] = process.env[key];
    }
    // 정리(removeDeletingObjects)가 앱과 같은 방식으로 설정을 읽는다.
    process.env.NEXT_PUBLIC_SUPABASE_URL = live.url;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = live.anonKey;
    process.env.MEM_SUPABASE_SERVICE_ROLE_KEY = live.serviceKey ?? '';

    const accounts = loadMemAccounts();
    tokenA = await signIn(live, accounts.a);
    tokenB = await signIn(live, accounts.b);
    service = createClient(live.url, live.serviceKey ?? '', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const members = await serviceSelect<{ space_id: string }[]>(live, 'space_members', `select=space_id&user_id=eq.${accounts.a.userId}`);
    const spaceId = members.data?.[0]?.space_id ?? '';
    expect(spaceId.length > 0).toBe(true);

    depsA = {
      userClient: userClient(tokenA),
      userId: accounts.a.userId ?? '',
      spaceId,
      service,
      storageRequest,
      verify: verifyMemoryPhoto,
    };
    depsB = { ...depsA, userClient: userClient(tokenB), userId: accounts.b.userId ?? '' };
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('정상 파일: 실제 bytes·치수를 기록하고 객체를 바꾸지 않는다', async () => {
    const bytes = await webp(320, 200, 1);
    const asset = await prepareAndUpload(tokenA, bytes, 'image/webp');
    const before = await objectHash(asset);

    expect(await finalizeOwnedMemoryPhoto(depsA, asset.assetId, 'memory')).toEqual({ ok: true, data: { assetId: asset.assetId } });
    expect(await row(asset.assetId)).toMatchObject({ state: 'ready', bytes: bytes.byteLength, width: 320, height: 200 });
    expect(await objectHash(asset)).toBe(before);
    expect(before).toBe(sha(bytes));
  });

  it('동시 확정 3건: 모두 성공(또는 재시도 가능)하고 한 번만 확정되며 객체는 그대로다', async () => {
    const bytes = await webp(300, 300, 2);
    const asset = await prepareAndUpload(tokenA, bytes, 'image/webp');

    const results = await Promise.all([1, 2, 3].map(() => finalizeOwnedMemoryPhoto(depsA, asset.assetId, 'memory')));
    for (const result of results) {
      expect(result.ok || result.code === 'RETRYABLE_ERROR').toBe(true);
    }
    expect((await finalizeOwnedMemoryPhoto(depsA, asset.assetId, 'memory')).ok).toBe(true);
    expect(await row(asset.assetId)).toMatchObject({ state: 'ready', bytes: bytes.byteLength });
    expect(await objectHash(asset)).toBe(sha(bytes));
  });

  it('확정 응답을 잃고 다시 불러도(이미 ready) 아무것도 바꾸지 않는다', async () => {
    const bytes = await webp(200, 100, 3);
    const asset = await prepareAndUpload(tokenA, bytes, 'image/webp');
    expect((await finalizeOwnedMemoryPhoto(depsA, asset.assetId, 'memory')).ok).toBe(true);
    const first = await row(asset.assetId);

    expect((await finalizeOwnedMemoryPhoto(depsA, asset.assetId, 'memory')).ok).toBe(true);
    expect(await row(asset.assetId)).toEqual(first);
    expect(await objectHash(asset)).toBe(sha(bytes));
  });

  it('RPC가 중간에 끊겨도 객체는 그대로이고, 같은 asset 재시도로 확정된다', async () => {
    const bytes = await webp(160, 90, 4);
    const asset = await prepareAndUpload(tokenA, bytes, 'image/webp');

    let calls = 0;
    const flaky = new Proxy(service, {
      get(target, property, receiver) {
        if (property === 'rpc') {
          return (fn: string, args?: Record<string, unknown>) => {
            calls += 1;
            if (calls === 1) return Promise.resolve({ data: null, error: { code: '', message: 'network', details: null, hint: null } });
            return target.rpc(fn, args);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const interrupted = await finalizeOwnedMemoryPhoto({ ...depsA, service: flaky }, asset.assetId, 'memory');
    expect(interrupted.ok).toBe(false);
    if (!interrupted.ok) expect(interrupted.code).toBe('RETRYABLE_ERROR');
    expect((await row(asset.assetId))?.state).toBe('pending');
    expect(await objectHash(asset)).toBe(sha(bytes));

    expect((await finalizeOwnedMemoryPhoto(depsA, asset.assetId, 'memory')).ok).toBe(true);
    expect(await objectHash(asset)).toBe(sha(bytes));
  });

  it('업로드 응답 유실: 같은 경로 재업로드는 거부되고(덮어쓰기 없음) 원래 객체로 확정된다', async () => {
    const bytes = await webp(120, 120, 5);
    const asset = await prepareAndUpload(tokenA, bytes, 'image/webp');
    const other = await webp(120, 120, 99);
    expect(await storageUpload(live, tokenA, BUCKET, asset.objectPath, other, 'image/webp')).not.toBe(200);
    expect(await storageUpload(live, tokenA, BUCKET, asset.objectPath, other, 'image/webp', true)).not.toBe(200);

    expect((await finalizeOwnedMemoryPhoto(depsA, asset.assetId, 'memory')).ok).toBe(true);
    expect(await objectHash(asset)).toBe(sha(bytes));
  });

  it('아직 올리지 않은 asset은 같은 asset으로 다시 올리라고 답한다(정리하지 않음)', async () => {
    const bytes = await webp(100, 80, 6);
    const asset = await prepare(tokenA, 'image/webp', bytes.byteLength);

    const early = await finalizeOwnedMemoryPhoto(depsA, asset.assetId, 'memory');
    expect(early.ok).toBe(false);
    if (!early.ok) {
      expect(early.code).toBe('RETRYABLE_ERROR');
      expect(early.retryStage).toBe('upload');
    }
    expect((await row(asset.assetId))?.state).toBe('pending');

    expect(await storageUpload(live, tokenA, BUCKET, asset.objectPath, bytes, 'image/webp')).toBe(200);
    expect((await finalizeOwnedMemoryPhoto(depsA, asset.assetId, 'memory')).ok).toBe(true);
  });

  it('확정과 취소가 동시에 와도 객체 바이트는 바뀌지 않고 상태는 ready 또는 deleting 중 하나다', async () => {
    const bytes = await webp(140, 140, 7);
    const asset = await prepareAndUpload(tokenA, bytes, 'image/webp');

    await Promise.all([
      finalizeOwnedMemoryPhoto(depsA, asset.assetId, 'memory'),
      rpc(live, tokenA, 'discard_upload', { p_asset_id: asset.assetId, p_request_id: randomUUID() }),
    ]);

    const state = (await row(asset.assetId))?.state;
    expect(['ready', 'deleting']).toContain(state);
    const hash = await objectHash(asset);
    // 남아 있다면 원래 바이트 그대로다(정리로 지워졌을 수는 있다).
    expect(hash === null || hash === sha(bytes)).toBe(true);
    if (state === 'deleting') {
      const after = await finalizeOwnedMemoryPhoto(depsA, asset.assetId, 'memory');
      expect(after.ok).toBe(false);
      expect((await row(asset.assetId))?.state).toBe('deleting');
    }
  });

  it('기록에 붙은 사진은 확정을 다시 불러도, 사용자가 덮어쓰려 해도 바뀌지 않는다', async () => {
    const bytes = await webp(180, 120, 8);
    const asset = await prepareAndUpload(tokenA, bytes, 'image/webp');
    expect((await finalizeOwnedMemoryPhoto(depsA, asset.assetId, 'memory')).ok).toBe(true);

    const saved = await rpc(live, tokenA, 'save_memory', {
      p_memory_id: null,
      p_title: `확정 불변 ${randomUUID().slice(0, 8)}`,
      p_body: '',
      p_memory_date: '2026-06-01',
      p_location: null,
      p_tags: [],
      p_photo_asset_ids: [asset.assetId],
      p_is_pinned: false,
      p_expected_version: 0,
      p_request_id: randomUUID(),
    });
    expect(saved.status).toBe(200);

    expect((await finalizeOwnedMemoryPhoto(depsA, asset.assetId, 'memory')).ok).toBe(true);
    expect(await storageUpload(live, tokenA, BUCKET, asset.objectPath, await webp(180, 120, 77), 'image/webp', true)).not.toBe(200);
    expect(await objectHash(asset)).toBe(sha(bytes));
  });

  it('규칙 위반(EXIF 남은 JPEG·긴 변 초과)은 거부하고 그 asset만 정리한다', async () => {
    const jpeg = withExifOrientation6(
      await sharp({ create: { width: 200, height: 100, channels: 3, background: '#336699' } }).jpeg().toBuffer(),
    );
    const exifAsset = await prepareAndUpload(tokenA, jpeg, 'image/jpeg');
    const exifResult = await finalizeOwnedMemoryPhoto(depsA, exifAsset.assetId, 'memory');
    expect(exifResult.ok).toBe(false);
    if (!exifResult.ok) expect(exifResult.code).toBe('UPLOAD_FAILED');
    expect((await row(exifAsset.assetId))?.state).toBe('deleting');
    expect(isMissingObjectStatus((await serviceDownload(live, BUCKET, exifAsset.objectPath)).status)).toBe(true);

    const wide = await sharp({ create: { width: 3000, height: 100, channels: 3, background: '#000000' } }).png().toBuffer();
    const wideAsset = await prepareAndUpload(tokenA, wide, 'image/png');
    const wideResult = await finalizeOwnedMemoryPhoto(depsA, wideAsset.assetId, 'memory');
    expect(wideResult.ok).toBe(false);
    expect((await row(wideAsset.assetId))?.state).toBe('deleting');
  });

  it('상대 구성원은 내 pending asset을 확정할 수 없다(사용자 RLS에서 막힘, 상태 불변)', async () => {
    const bytes = await webp(90, 90, 9);
    const asset = await prepareAndUpload(tokenA, bytes, 'image/webp');

    const result = await finalizeOwnedMemoryPhoto(depsB, asset.assetId, 'memory');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
    expect((await row(asset.assetId))?.state).toBe('pending');
    expect(await objectHash(asset)).toBe(sha(bytes));
  });
});
