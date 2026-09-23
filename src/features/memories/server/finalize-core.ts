import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { newRequestId } from '@/features/auth/request-id';

import { MEMORY_BUCKET, MEMORY_PHOTO_MAX_BYTES, isMemoryUploadMime, type MemoryUploadMime } from '../live/constants';
import {
  logMemoryFailure,
  mapMemoryRpcError,
  memoryFailure,
  type MemoryActionFailure,
  type MemoryActionResult,
} from '../live/errors';
import { PHOTO_REJECT_MESSAGES, type PhotoRejectReason } from '../live/image-policy';

import { readBoundedBody } from './bounded-read';
import { removeDeletingObjects } from './cleanup';
import { expectedObjectPath, parseDetachedAssets } from './cleanup-plan';
import { finalizeRequestId } from './finalize-key';
import type { VerifyResult } from './image-verify';

/**
 * 업로드 확정 프로토콜(Next 런타임과 무관한 핵심). 호출자가 세션을 확인한 뒤 부른다.
 *
 * 용도(`purpose`)는 **호출자가 반드시 명시**한다. 기본값을 두지 않는다.
 * 기본값이 있으면 커버 확정 경로에서 인자를 빠뜨렸을 때 조용히 `memory`로 확정돼
 * 추억 사진이 커버로, 커버가 추억 사진으로 섞일 수 있다. 확인 실패는 `NOT_FOUND`다
 * (존재 여부를 알리지 않는다).
 *
 * 불변식
 *   - service 작업 전에 **사용자 세션 클라이언트(RLS)** 로 asset이 본인 업로드·본인 공간·**요청한 용도**·생성 경로인지 확인한다.
 *   - Storage 객체는 사용자가 한 번 INSERT(upsert=false)한 뒤 **아무도 바꾸지 않는다.** 서버는 읽기만 한다.
 *     (사용자에게 UPDATE/DELETE 정책이 없고, 이 코드는 업로드·덮어쓰기를 하지 않는다.)
 *   - 확정 requestId는 asset ID에서 결정적으로 만들고, 페이로드(실제 bytes·치수·형식)는 불변 객체에서 나오므로
 *     재시도·동시 확정은 같은 페이로드로 DB 멱등성에 합류한다.
 *   - 이미 ready면 아무것도 하지 않고 성공이다.
 *   - 거부(규칙 위반·만료·정리 중)는 사용자 세션으로 `discard_upload`한 뒤 그 응답의 경로만 정리한다.
 *     첨부된 asset은 `discard_upload`가 거부하므로 정리되지 않는다.
 */

/** `assets.purpose`. DB(CONTRACTS.md 2)의 `memory | cover`와 같은 값이다. */
export type AssetPurpose = 'memory' | 'cover';

/** 용도별 로그 작업 이름. 공용 파이프라인이라 접두사는 `memories.`로 같다. */
function operationFor(purpose: AssetPurpose): string {
  return purpose === 'cover' ? 'finalizeCover' : 'finalizePhoto';
}

export type FinalizeDeps = {
  userClient: SupabaseClient;
  userId: string;
  spaceId: string;
  service: SupabaseClient;
  storageRequest: (path: string) => { url: string; headers: Record<string, string> } | null;
  verify: (bytes: Uint8Array, mime: MemoryUploadMime) => Promise<VerifyResult>;
};

type OwnAssetRow = {
  id: string;
  space_id: string;
  uploader_id: string;
  purpose: string;
  state: string;
  mime_type: string;
  object_path: string;
};

/**
 * 사용자 세션(RLS)으로 asset을 읽고 소유·공간·용도·경로를 확인한다.
 * `purpose`는 호출자가 명시한다. 다른 용도로 올린 파일은 존재 여부를 알리지 않고 `NOT_FOUND`다.
 */
export async function readOwnAsset(
  deps: Pick<FinalizeDeps, 'userClient' | 'userId' | 'spaceId'>,
  assetId: string,
  purpose: AssetPurpose,
): Promise<{ ok: true; asset: OwnAssetRow } | MemoryActionFailure> {
  const { data, error } = await deps.userClient
    .from('assets')
    .select('id, space_id, uploader_id, purpose, state, mime_type, object_path')
    .eq('id', assetId)
    .maybeSingle();
  if (error) return (error.code ?? '') === '' ? memoryFailure('RETRYABLE_ERROR') : memoryFailure('NOT_FOUND');

  const asset = data as OwnAssetRow | null;
  if (
    !asset ||
    asset.uploader_id !== deps.userId ||
    asset.space_id !== deps.spaceId ||
    asset.purpose !== purpose ||
    !expectedObjectPath(deps.spaceId, asset.id, asset.object_path)
  ) {
    return memoryFailure('NOT_FOUND');
  }
  return { ok: true, asset };
}

/** 사용자 세션으로 자기 미첨부 asset을 취소하고 DB 응답의 경로만 정리한다. 실패해도 호출자 결과는 바꾸지 않는다. */
export async function discardOwnAsset(
  deps: Pick<FinalizeDeps, 'userClient' | 'spaceId'>,
  assetId: string,
  operation: string,
): Promise<void> {
  const { data, error } = await deps.userClient.rpc('discard_upload', {
    p_asset_id: assetId,
    p_request_id: newRequestId(),
  });
  if (error) {
    logMemoryFailure(`${operation}.discard`, mapMemoryRpcError(error).code);
    return;
  }
  await removeDeletingObjects(parseDetachedAssets([data], deps.spaceId), deps.spaceId, operation);
}

async function reject(
  deps: FinalizeDeps,
  assetId: string,
  purpose: AssetPurpose,
  reason: PhotoRejectReason,
): Promise<MemoryActionFailure> {
  console.error(`memories.${operationFor(purpose)} code=UPLOAD_FAILED reason=${reason}`);
  await discardOwnAsset(deps, assetId, 'rejectPhoto');
  return memoryFailure('UPLOAD_FAILED', PHOTO_REJECT_MESSAGES[reason]);
}

/** 객체가 아직 없을 때. 같은 pending asset·같은 경로로 다시 올리라는 뜻이다(새 asset을 만들지 않는다). */
function notUploadedYet(): MemoryActionFailure {
  return {
    ...memoryFailure('RETRYABLE_ERROR', '사진 파일이 아직 올라가지 않았어요. 다시 시도해 주세요.'),
    retryStage: 'upload',
  };
}

export async function finalizeOwnedMemoryPhoto(
  deps: FinalizeDeps,
  rawAssetId: string,
  /** 호출자가 확정하려는 용도. 기본값 없음(잘못 섞이면 조용히 성공하지 않고 NOT_FOUND가 된다). */
  purpose: AssetPurpose,
): Promise<MemoryActionResult<{ assetId: string }>> {
  const assetId = rawAssetId.toLowerCase();

  // 1. 사용자 RLS로 소유·공간·목적·경로 확인. 통과 전에는 service 작업이 없다.
  const owned = await readOwnAsset(deps, assetId, purpose);
  if (!owned.ok) return owned;
  const asset = owned.asset;

  if (asset.state === 'ready') return { ok: true, data: { assetId } };
  if (asset.state !== 'pending') return memoryFailure('UPLOAD_FAILED', PHOTO_REJECT_MESSAGES.decode_failed);
  const declaredMime = asset.mime_type;
  if (!isMemoryUploadMime(declaredMime)) return reject(deps, assetId, purpose, 'unsupported_format');

  // 2. 읽기 전용 다운로드(크기 상한). 서버가 만든 경로만.
  const encodedPath = asset.object_path.split('/').map(encodeURIComponent).join('/');
  const request = deps.storageRequest(`object/${MEMORY_BUCKET}/${encodedPath}`);
  if (!request) return memoryFailure('PHOTOS_DISABLED');

  let response: Response;
  try {
    response = await fetch(request.url, {
      headers: request.headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return memoryFailure('RETRYABLE_ERROR');
  }
  if (response.status === 400 || response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return notUploadedYet();
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return memoryFailure('RETRYABLE_ERROR');
  }

  const body = await readBoundedBody(response.body, MEMORY_PHOTO_MAX_BYTES, response.headers.get('content-length'));
  if (!body.ok) {
    if (body.reason === 'read_failed') return memoryFailure('RETRYABLE_ERROR');
    return reject(deps, assetId, purpose, body.reason === 'empty' ? 'empty' : 'too_large');
  }

  // 3. 실제 디코딩 검증(쓰기 없음)
  const checked = await deps.verify(body.bytes, declaredMime);
  if (!checked.ok) return reject(deps, assetId, purpose, checked.reason);
  const photo = checked.photo;

  // 4. 확정(service 전용 RPC). 기록 값은 불변 객체의 실제 값이다.
  const { error } = await deps.service.rpc('finalize_upload', {
    p_asset_id: assetId,
    p_uploader_id: deps.userId,
    p_bytes: photo.bytes,
    p_width: photo.width,
    p_height: photo.height,
    p_verified_mime_type: photo.mime,
    p_request_id: finalizeRequestId(assetId),
  });

  if (error) {
    const failure = mapMemoryRpcError(error);
    // 동시 확정이 먼저 끝났거나 처리 중일 수 있다. 실제 상태로 판단한다.
    const again = await readOwnAsset(deps, assetId, purpose);
    if (again.ok && again.asset.state === 'ready') return { ok: true, data: { assetId } };
    logMemoryFailure(operationFor(purpose), failure.code);
    if (failure.code === 'UPLOAD_FAILED') {
      await discardOwnAsset(deps, assetId, 'rejectPhoto');
      return memoryFailure('UPLOAD_FAILED', failure.message);
    }
    if (failure.code === 'CONFLICT' || failure.code === 'RETRYABLE_ERROR') return memoryFailure('RETRYABLE_ERROR');
    return failure;
  }

  return { ok: true, data: { assetId } };
}
