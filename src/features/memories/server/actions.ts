'use server';

import { revalidatePath } from 'next/cache';

import { parseMemoryFilters } from '../filters';
import { MEMORY_BUCKET, type MemoryUploadMime } from '../live/constants';
import {
  MEMORY_CODE_MESSAGES,
  logMemoryFailure,
  mapMemoryRpcError,
  memoryFailure,
  type MemoryActionResult,
} from '../live/errors';
import { PHOTO_REJECT_MESSAGES } from '../live/image-policy';
import {
  deleteMemoryInputSchema,
  discardPhotoInputSchema,
  finalizePhotoInputSchema,
  loadMoreInputSchema,
  pinMemoryInputSchema,
  preparePhotoInputSchema,
  saveMemoryInputSchema,
  toMemoryFieldErrors,
  type SaveMemoryInput,
} from '../live/input-schema';
import type {
  DeleteMemoryData,
  LiveMemoryPage,
  PhotoCleanupStatus,
  PreparedPhoto,
  SaveMemoryData,
} from '../live/types';

import { removeDeletingObjects } from './cleanup';
import { expectedObjectPath, parseDetachedAssets } from './cleanup-plan';
import { finalizeOwnedMemoryPhoto } from './finalize-core';
import type { VerifyResult } from './image-verify';
import { requireMemberSession } from './member-session';
import { listMemoriesPage } from './queries';
import { createServiceClient, isPhotoPipelineConfigured, serviceStorageRequest } from './service-client';

/**
 * 추억 Server Action.
 *
 * 공통 규칙
 *   - 매 호출마다 서버가 세션과 공간 소속을 다시 확인한다(`getSessionContext` → Auth `getUser`).
 *     클라이언트가 보낸 사용자·공간 ID는 받지 않는다.
 *   - 사용자 작업은 **사용자 세션 클라이언트 + RLS + 전용 RPC**로만 한다.
 *   - service_role(별도 워커 클라이언트)은 업로드 확정(사용자 RLS로 소유 확인 뒤, 읽기 전용 검증)과
 *     DB가 알려 준 `deleting` 파일 정리에만 쓴다.
 *   - 로그에는 작업 이름·오류 코드·요청 ID만 남긴다.
 *
 * 세션 검사는 `./member-session.ts`에 있다(연결 액션과 같은 구현을 쓴다).
 */

function revalidateMemoryScreens(): void {
  // 목록·상세·편집·홈 요약이 모두 같은 데이터를 쓴다. 이전 사용자의 화면을 재사용하지 않도록 전부 비운다.
  revalidatePath('/', 'layout');
}

type SaveMemoryRpcResult = {
  memoryId?: string;
  version?: number;
  detachedAssets?: unknown;
};

/** 검증된 입력 그대로 `save_memory`를 호출한다. 같은 입력·같은 requestId면 DB가 이전 결과를 재생한다. */
async function callSaveMemory(
  operation: string,
  input: SaveMemoryInput,
): Promise<MemoryActionResult<SaveMemoryData>> {
  const session = await requireMemberSession();
  if (!session.ok) return session;
  const { client, spaceId } = session.member;

  const { data, error } = await client.rpc('save_memory', {
    p_memory_id: input.memoryId,
    p_title: input.title,
    p_body: input.body,
    p_memory_date: input.memoryDate,
    p_location: input.location.length > 0 ? input.location : null,
    p_tags: input.tags,
    p_photo_asset_ids: input.photoAssetIds,
    p_is_pinned: input.isPinned,
    p_expected_version: input.expectedVersion,
    p_request_id: input.requestId,
  });

  if (error) {
    const failure = mapMemoryRpcError(error);
    logMemoryFailure(operation, failure.code, input.requestId);
    return failure;
  }

  const result = (data ?? {}) as SaveMemoryRpcResult;
  if (typeof result.memoryId !== 'string' || typeof result.version !== 'number') {
    logMemoryFailure(operation, 'UNKNOWN', input.requestId);
    return memoryFailure('UNKNOWN');
  }

  const cleanup = await removeDeletingObjects(parseDetachedAssets(result.detachedAssets, spaceId), spaceId, operation);
  revalidateMemoryScreens();
  return { ok: true, data: { memoryId: result.memoryId, version: result.version, cleanup } };
}

// ---------------------------------------------------------------------------
// 저장 / 삭제 / 고정
// ---------------------------------------------------------------------------

export async function saveMemoryAction(raw: unknown): Promise<MemoryActionResult<SaveMemoryData>> {
  const parsed = saveMemoryInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = toMemoryFieldErrors(parsed.error);
    const first = Object.values(fieldErrors)[0];
    return memoryFailure('VALIDATION_ERROR', first ?? MEMORY_CODE_MESSAGES.VALIDATION_ERROR, fieldErrors);
  }
  return callSaveMemory('saveMemory', parsed.data);
}

/**
 * 홈 고정/해제. 전용 RPC가 없으므로 `save_memory`에 **화면이 보고 있던 스냅샷**(서버가 렌더한 값 그대로)과
 * 바뀐 고정 여부만 보낸다. 서버가 다시 읽지 않는다:
 *   - 응답을 잃은 재시도는 같은 스냅샷·같은 requestId라 DB가 이전 결과를 재생한다(다시 읽으면 버전이 이미
 *     올라가 있어 재시도가 충돌로 바뀌고, 페이로드도 달라진다).
 *   - 그 사이 상대가 저장했다면 `expectedVersion`이 달라 DB가 CONFLICT로 거부한다. 스냅샷이 상대 수정을
 *     덮어쓸 수 없다. 권한·공간은 RPC가 세션으로 다시 검사한다.
 */
export async function setMemoryPinnedAction(raw: unknown): Promise<MemoryActionResult<SaveMemoryData>> {
  const parsed = pinMemoryInputSchema.safeParse(raw);
  if (!parsed.success) return memoryFailure('NOT_FOUND');
  return callSaveMemory('setMemoryPinned', parsed.data);
}

export async function deleteMemoryAction(raw: unknown): Promise<MemoryActionResult<DeleteMemoryData>> {
  const parsed = deleteMemoryInputSchema.safeParse(raw);
  if (!parsed.success) return memoryFailure('NOT_FOUND');
  const input = parsed.data;

  const session = await requireMemberSession();
  if (!session.ok) return session;
  const { client, spaceId } = session.member;

  const { data, error } = await client.rpc('delete_memory', {
    p_memory_id: input.memoryId,
    p_expected_version: input.expectedVersion,
    p_request_id: input.requestId,
  });

  if (error) {
    const failure = mapMemoryRpcError(error);
    logMemoryFailure('deleteMemory', failure.code, input.requestId);
    return failure;
  }

  const result = (data ?? {}) as { memoryId?: string; detachedAssets?: unknown };
  const cleanup = await removeDeletingObjects(
    parseDetachedAssets(result.detachedAssets, spaceId),
    spaceId,
    'deleteMemory',
  );
  revalidateMemoryScreens();
  return { ok: true, data: { memoryId: input.memoryId, cleanup } };
}

// ---------------------------------------------------------------------------
// 목록 더 보기
// ---------------------------------------------------------------------------

export async function loadMoreMemoriesAction(raw: unknown): Promise<MemoryActionResult<LiveMemoryPage>> {
  const parsed = loadMoreInputSchema.safeParse(raw);
  if (!parsed.success) return memoryFailure('VALIDATION_ERROR');

  const filters = parseMemoryFilters({ month: parsed.data.month, tag: parsed.data.tag });
  const result = await listMemoriesPage({ ...filters, cursor: parsed.data.cursor });
  if (!result.ok) return memoryFailure(result.code);
  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------------
// 사진: 준비 → (브라우저가 정규화 후 표준 업로드 1회) → 읽기 전용 확정 / 취소
// ---------------------------------------------------------------------------

export async function prepareMemoryPhotoAction(raw: unknown): Promise<MemoryActionResult<PreparedPhoto>> {
  const parsed = preparePhotoInputSchema.safeParse(raw);
  if (!parsed.success) {
    return memoryFailure('VALIDATION_ERROR', PHOTO_REJECT_MESSAGES.unsupported_format);
  }
  const input = parsed.data;

  // 확정할 수 없는 파일을 만들지 않는다. 설정이 없으면 사진 기능만 꺼진다.
  if (!isPhotoPipelineConfigured()) return memoryFailure('PHOTOS_DISABLED');

  const session = await requireMemberSession();
  if (!session.ok) return session;
  const { client, spaceId } = session.member;

  const { data, error } = await client.rpc('prepare_upload', {
    p_purpose: 'memory',
    p_mime_type: input.mimeType,
    p_bytes: input.bytes,
    p_request_id: input.requestId,
  });

  if (error) {
    const failure = mapMemoryRpcError(error);
    logMemoryFailure('preparePhoto', failure.code, input.requestId);
    return failure.code === 'VALIDATION_ERROR'
      ? memoryFailure('VALIDATION_ERROR', PHOTO_REJECT_MESSAGES.too_large)
      : failure;
  }

  const result = (data ?? {}) as { assetId?: unknown; bucket?: unknown; objectPath?: unknown };
  if (
    typeof result.assetId !== 'string' ||
    result.bucket !== MEMORY_BUCKET ||
    typeof result.objectPath !== 'string' ||
    !expectedObjectPath(spaceId, result.assetId, result.objectPath)
  ) {
    logMemoryFailure('preparePhoto', 'UNKNOWN', input.requestId);
    return memoryFailure('UNKNOWN');
  }

  return {
    ok: true,
    data: { assetId: result.assetId, bucket: result.bucket, objectPath: result.objectPath },
  };
}

async function loadVerifier(): Promise<((bytes: Uint8Array, mime: MemoryUploadMime) => Promise<VerifyResult>) | null> {
  try {
    return (await import('./image-verify')).verifyMemoryPhoto;
  } catch {
    console.error('memories.finalizePhoto code=PHOTOS_DISABLED reason=decoder_unavailable');
    return null;
  }
}

/** 업로드 확정. 프로토콜은 `finalize-core.ts` 참고(사용자 RLS 확인 → 읽기 전용 검증 → service RPC). */
export async function finalizeMemoryPhotoAction(
  raw: unknown,
): Promise<MemoryActionResult<{ assetId: string }>> {
  const parsed = finalizePhotoInputSchema.safeParse(raw);
  if (!parsed.success) return memoryFailure('NOT_FOUND');

  const service = createServiceClient();
  if (!service) return memoryFailure('PHOTOS_DISABLED');

  const session = await requireMemberSession();
  if (!session.ok) return session;

  const verify = await loadVerifier();
  if (!verify) return memoryFailure('PHOTOS_DISABLED');

  return finalizeOwnedMemoryPhoto(
    {
      userClient: session.member.client,
      userId: session.member.userId,
      spaceId: session.member.spaceId,
      service,
      storageRequest: serviceStorageRequest,
      verify,
    },
    parsed.data.assetId,
    // 용도는 항상 명시한다. 추억 화면은 `memory` 파일만 확정한다(커버 파일은 여기서 확정되지 않는다).
    'memory',
  );
}

/** 사용자가 뺀(아직 기록에 붙지 않은) 자기 사진을 정리한다. */
export async function discardMemoryPhotoAction(
  raw: unknown,
): Promise<MemoryActionResult<{ assetId: string; cleanup: PhotoCleanupStatus }>> {
  const parsed = discardPhotoInputSchema.safeParse(raw);
  if (!parsed.success) return memoryFailure('NOT_FOUND');
  const input = parsed.data;

  const session = await requireMemberSession();
  if (!session.ok) return session;
  const { client, spaceId } = session.member;

  const { data, error } = await client.rpc('discard_upload', {
    p_asset_id: input.assetId,
    p_request_id: input.requestId,
  });
  if (error) {
    const failure = mapMemoryRpcError(error);
    logMemoryFailure('discardPhoto', failure.code, input.requestId);
    return failure;
  }

  const cleanup = await removeDeletingObjects(parseDetachedAssets([data], spaceId), spaceId, 'discardPhoto');
  return { ok: true, data: { assetId: input.assetId, cleanup } };
}
