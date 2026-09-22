import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { removeDeletingObjects } from '@/features/memories/server/cleanup';
import { parseDetachedAssets } from '@/features/memories/server/cleanup-plan';

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
  syntheticPng,
  type MemTestEnv,
} from '../support/local-api';

/**
 * 파일 정리의 실제 백엔드 검증(로컬 Supabase).
 *
 *   - 서버 자격 증명이 없으면 정리는 "보류"로 끝나고 객체·deleting 상태가 그대로 남는다(DB 변경은 되돌리지 않는다).
 *   - 자격 증명을 되돌린 뒤 **같은 대상**으로 다시 시도하면 객체가 지워진다(재시도 가능).
 *   - 다른 공간 경로를 섞어도 규칙에 맞지 않는 항목은 정리 대상에서 빠진다.
 *
 * 앱 코드(removeDeletingObjects)를 그대로 부르고, 호출 대상은 실제 로컬 Storage/PostgREST다.
 */

const env = readMemTestEnv();
const ready = env !== null && env.serviceKey !== null && existsSync(MEM_ACCOUNTS_PATH);

describe.skipIf(!ready)('Storage 정리 — 실패 보류와 대상 재시도', () => {
  const live = env as MemTestEnv;
  const saved: Record<string, string | undefined> = {};
  let token = '';
  let spaceId = '';

  beforeAll(async () => {
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'MEM_SUPABASE_SERVICE_ROLE_KEY']) {
      saved[key] = process.env[key];
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = live.url;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = live.anonKey;

    const accounts = loadMemAccounts();
    token = await signIn(live, accounts.a);
    const members = await serviceSelect<{ space_id: string }[]>(
      live,
      'space_members',
      `select=space_id&user_id=eq.${accounts.a.userId}`,
    );
    spaceId = members.data?.[0]?.space_id ?? '';
    expect(spaceId.length > 0).toBe(true);
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('자격 증명이 없으면 보류, 되돌린 뒤 같은 대상 재시도로 정리된다', async () => {
    const png = syntheticPng(16, 16, [10, 20, 30]);
    const prepared = await rpc<{ assetId: string; bucket: string; objectPath: string }>(live, token, 'prepare_upload', {
      p_purpose: 'memory',
      p_mime_type: 'image/png',
      p_bytes: png.byteLength,
      p_request_id: randomUUID(),
    });
    expect(prepared.status).toBe(200);
    const asset = prepared.data;
    if (!asset) throw new Error('prepare_upload 응답 없음');

    expect(await storageUpload(live, token, asset.bucket, asset.objectPath, png, 'image/png')).toBe(200);

    const discarded = await rpc(live, token, 'discard_upload', { p_asset_id: asset.assetId, p_request_id: randomUUID() });
    expect(discarded.status).toBe(200);
    const targets = parseDetachedAssets([discarded.data], spaceId);
    expect(targets).toHaveLength(1);

    // 1) 서버 자격 증명 없음 → 보류. 객체와 deleting 상태가 남는다.
    process.env.MEM_SUPABASE_SERVICE_ROLE_KEY = '';
    expect(await removeDeletingObjects(targets, spaceId, 'test')).toBe('pending');
    expect((await serviceDownload(live, asset.bucket, asset.objectPath)).status).toBe(200);
    const row = await serviceSelect<{ state: string }[]>(live, 'assets', `select=state&id=eq.${asset.assetId}`);
    expect(row.data?.[0]?.state).toBe('deleting');

    // 2) 같은 대상으로 재시도 → 정리
    process.env.MEM_SUPABASE_SERVICE_ROLE_KEY = live.serviceKey ?? '';
    expect(await removeDeletingObjects(targets, spaceId, 'test')).toBe('done');
    expect(isMissingObjectStatus((await serviceDownload(live, asset.bucket, asset.objectPath)).status)).toBe(true);

    // 3) 이미 지운 뒤 다시 시도해도 성공(멱등)
    expect(await removeDeletingObjects(targets, spaceId, 'test')).toBe('done');
  });

  it('deleting이 아닌 자산은 정리 요청이 와도 지우지 않는다', async () => {
    process.env.MEM_SUPABASE_SERVICE_ROLE_KEY = live.serviceKey ?? '';
    const png = syntheticPng(8, 8, [1, 2, 3]);
    const prepared = await rpc<{ assetId: string; bucket: string; objectPath: string }>(live, token, 'prepare_upload', {
      p_purpose: 'memory',
      p_mime_type: 'image/png',
      p_bytes: png.byteLength,
      p_request_id: randomUUID(),
    });
    const asset = prepared.data;
    if (!asset) throw new Error('prepare_upload 응답 없음');
    expect(await storageUpload(live, token, asset.bucket, asset.objectPath, png, 'image/png')).toBe(200);

    // pending 상태 그대로인 자산을 정리 대상처럼 넘겨도 보류하고 객체를 남긴다.
    const status = await removeDeletingObjects(
      [{ assetId: asset.assetId, objectPath: asset.objectPath }],
      spaceId,
      'test',
    );
    expect(status).toBe('pending');
    expect((await serviceDownload(live, asset.bucket, asset.objectPath)).status).toBe(200);

    // 정리: 취소 후 지운다.
    const discarded = await rpc(live, token, 'discard_upload', { p_asset_id: asset.assetId, p_request_id: randomUUID() });
    expect(await removeDeletingObjects(parseDetachedAssets([discarded.data], spaceId), spaceId, 'test')).toBe('done');
  });
});
