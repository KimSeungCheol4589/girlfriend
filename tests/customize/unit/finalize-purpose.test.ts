import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  finalizeOwnedMemoryPhoto,
  readOwnAsset,
  type AssetPurpose,
  type FinalizeDeps,
} from '@/features/memories/server/finalize-core';

/**
 * 용도(`purpose`) 명시 회귀 — THEME-001.
 *
 * 커버와 추억 사진은 **같은 파이프라인·같은 버킷**을 쓰고 용도만 다르다. 확정기가 용도를 스스로
 * 정하거나 기본값을 쓰면, 커버 확정 경로에서 추억 사진이 커버로(또는 그 반대로) 확정될 수 있다.
 * 그래서 용도는 호출자가 **반드시** 넘기고, 용도가 다르면 존재 여부를 알리지 않는 `NOT_FOUND`다.
 *
 * 외부 연결이 없다. 사용자 클라이언트는 가짜이고, service 클라이언트와 Storage 요청은
 * **호출되면 실패하도록** 두어 "권한 있는 작업 전에 막힌다"는 것까지 확인한다.
 */

const SPACE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';

type AssetRow = {
  id: string;
  space_id: string;
  uploader_id: string;
  purpose: string;
  state: string;
  mime_type: string;
  object_path: string;
};

function assetRow(overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    id: ASSET,
    space_id: SPACE,
    uploader_id: USER,
    purpose: 'memory',
    state: 'pending',
    mime_type: 'image/webp',
    object_path: `${SPACE}/${ASSET}.webp`,
    ...overrides,
  };
}

/** `from('assets').select(...).eq('id', ...).maybeSingle()`만 답하는 가짜 사용자 클라이언트. */
function userClient(row: AssetRow | null): { client: SupabaseClient; rpcCalls: string[] } {
  const rpcCalls: string[] = [];
  const client = {
    from: (table: string) => {
      if (table !== 'assets') throw new Error(`예상 밖 테이블 조회: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
      };
    },
    rpc: async (fn: string) => {
      rpcCalls.push(fn);
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { client, rpcCalls };
}

/** 호출되면 즉시 실패한다. 용도 검사를 통과하기 전에는 권한 있는 작업이 없어야 한다. */
const forbiddenService = {
  rpc: async () => {
    throw new Error('용도 검사를 통과하기 전에 service RPC를 불렀다');
  },
} as unknown as SupabaseClient;

function deps(row: AssetRow | null): { deps: FinalizeDeps; rpcCalls: string[] } {
  const { client, rpcCalls } = userClient(row);
  return {
    deps: {
      userClient: client,
      userId: USER,
      spaceId: SPACE,
      service: forbiddenService,
      storageRequest: () => {
        throw new Error('용도 검사를 통과하기 전에 Storage를 읽었다');
      },
      verify: async () => {
        throw new Error('용도 검사를 통과하기 전에 디코딩했다');
      },
    },
    rpcCalls,
  };
}

describe('확정 용도는 호출자가 명시한다', () => {
  it('기본값이 없다(인자를 빠뜨리면 타입 오류이고, 런타임에도 세 번째 인자를 받는다)', () => {
    // 기본값을 주면 함수 arity가 2로 줄어든다. 3이어야 "기본값 없음"이 유지된다.
    expect(finalizeOwnedMemoryPhoto.length).toBe(3);
    expect(readOwnAsset.length).toBe(3);
  });

  it('추억용으로 올린 파일은 커버로 확정되지 않는다', async () => {
    const { deps: fake, rpcCalls } = deps(assetRow({ purpose: 'memory' }));
    const result = await finalizeOwnedMemoryPhoto(fake, ASSET, 'cover');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
    // 거부는 조용해야 한다. 취소(discard_upload)도 하지 않는다(내 파일이 아닐 수 있다).
    expect(rpcCalls).toEqual([]);
  });

  it('커버용으로 올린 파일은 추억 사진으로 확정되지 않는다', async () => {
    const { deps: fake } = deps(assetRow({ purpose: 'cover' }));
    const result = await finalizeOwnedMemoryPhoto(fake, ASSET, 'memory');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('이미 ready여도 용도가 다르면 거부한다(지름길이 용도 검사를 앞지르지 않는다)', async () => {
    // "이미 ready면 성공"은 **같은 용도**일 때만이다. 순서가 뒤집히면 추억 사진이 커버로 확정된다.
    for (const [assetPurpose, requested] of [
      ['memory', 'cover'],
      ['cover', 'memory'],
    ] as [AssetPurpose, AssetPurpose][]) {
      const { deps: fake, rpcCalls } = deps(assetRow({ purpose: assetPurpose, state: 'ready' }));
      const result = await finalizeOwnedMemoryPhoto(fake, ASSET, requested);
      expect(result.ok, `${assetPurpose} 파일을 ${requested}로 확정`).toBe(false);
      if (!result.ok) expect(result.code).toBe('NOT_FOUND');
      // 남의 용도 파일을 정리하지도 않는다.
      expect(rpcCalls).toEqual([]);
    }
  });

  it('용도가 맞고 이미 ready면 아무것도 하지 않고 성공이다', async () => {
    for (const purpose of ['memory', 'cover'] as AssetPurpose[]) {
      const { deps: fake, rpcCalls } = deps(assetRow({ purpose, state: 'ready' }));
      expect(await finalizeOwnedMemoryPhoto(fake, ASSET, purpose)).toEqual({
        ok: true,
        data: { assetId: ASSET },
      });
      expect(rpcCalls).toEqual([]);
    }
  });

  it('대문자 asset ID도 같은 파일로 본다', async () => {
    const { deps: fake } = deps(assetRow({ purpose: 'cover', state: 'ready' }));
    expect(await finalizeOwnedMemoryPhoto(fake, ASSET.toUpperCase(), 'cover')).toEqual({
      ok: true,
      data: { assetId: ASSET },
    });
  });
});

describe('용도 외의 소유 검사도 권한 있는 작업 전에 끝난다', () => {
  const cases: [string, Partial<AssetRow>][] = [
    ['다른 사람이 올린 파일', { purpose: 'cover', uploader_id: '44444444-4444-4444-8444-444444444444' }],
    ['다른 공간의 파일', { purpose: 'cover', space_id: '55555555-5555-4555-8555-555555555555' }],
    ['생성 규칙과 다른 경로', { purpose: 'cover', object_path: `${SPACE}/other.webp` }],
  ];

  for (const [name, overrides] of cases) {
    it(`${name}은 NOT_FOUND다`, async () => {
      const { deps: fake } = deps(assetRow(overrides));
      const result = await finalizeOwnedMemoryPhoto(fake, ASSET, 'cover');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('NOT_FOUND');
    });
  }

  it('없는 파일도 같은 NOT_FOUND다', async () => {
    const { deps: fake } = deps(null);
    const result = await finalizeOwnedMemoryPhoto(fake, ASSET, 'cover');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('readOwnAsset은 요청한 용도의 파일만 돌려준다', async () => {
    const { deps: fake } = deps(assetRow({ purpose: 'cover' }));
    const matched = await readOwnAsset(fake, ASSET, 'cover');
    expect(matched.ok).toBe(true);
    const mismatched = await readOwnAsset(fake, ASSET, 'memory');
    expect(mismatched.ok).toBe(false);
  });
});
