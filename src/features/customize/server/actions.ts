'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import { getSessionContext } from '@/features/auth/queries';
import type { MemoryUploadMime } from '@/features/memories/live/constants';
import { PHOTO_REJECT_MESSAGES } from '@/features/memories/live/image-policy';
import { removeDeletingObjects } from '@/features/memories/server/cleanup';
import { expectedObjectPath, parseDetachedAssets } from '@/features/memories/server/cleanup-plan';
import { finalizeOwnedMemoryPhoto } from '@/features/memories/server/finalize-core';
import type { VerifyResult } from '@/features/memories/server/image-verify';
import {
  createServiceClient,
  isPhotoPipelineConfigured,
  serviceStorageRequest,
} from '@/features/memories/server/service-client';
import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import { COVER_BUCKET, COVER_PURPOSE } from '../constants';
import {
  customizeFailure,
  fromPhotoResult,
  logCustomizeFailure,
  mapCustomizeRpcError,
  type CustomizeFailure,
  type CustomizeResult,
} from '../errors';
import {
  discardCoverInputSchema,
  finalizeCoverInputSchema,
  prepareCoverInputSchema,
  saveCustomizationInputSchema,
} from '../schema';
import { toHomeSectionsPayload } from '../sections';
import type { PreparedCover, SaveCustomizationData } from '../types';

/**
 * 꾸미기 Server Action.
 *
 * 공통 규칙
 *   - 매 호출마다 서버가 세션과 공간 소속을 다시 확인한다(`getSessionContext` → Auth `getUser`).
 *     클라이언트가 보낸 사용자·공간 ID는 받지 않는다.
 *   - 사용자 작업은 **사용자 세션 클라이언트 + RLS + 전용 RPC**로만 한다.
 *   - service_role(추억 모듈의 서버 전용 워커 클라이언트)은 커버 확정(사용자 RLS로 소유 확인 뒤
 *     읽기 전용 검증)과 **DB가 알려 준** `deleting` 파일 정리에만 쓴다.
 *   - 로그에는 작업 이름·오류 코드·요청 ID만 남긴다.
 *
 * 사진 파이프라인은 추억(MEM-001)과 같은 것을 쓰고 용도만 `cover`로 명시한다. 새로 만들지 않는다.
 */

type Member = { client: SupabaseClient; userId: string; spaceId: string };

async function requireMemberSession(): Promise<{ ok: true; member: Member } | CustomizeFailure> {
  const context = await getSessionContext();
  if (context.status === 'unconfigured') return customizeFailure('CONFIG_ERROR');
  if (context.status === 'anonymous') return customizeFailure('UNAUTHENTICATED');
  if (context.status === 'no_space') return customizeFailure('NOT_FOUND');

  let client: SupabaseClient;
  try {
    client = await createSupabaseServerClient();
  } catch (error) {
    if (isSupabaseConfigError(error)) return customizeFailure('CONFIG_ERROR');
    throw error;
  }
  return { ok: true, member: { client, userId: context.user.id, spaceId: context.space.id } };
}

// ---------------------------------------------------------------------------
// 설정 저장
// ---------------------------------------------------------------------------

type SaveRpcResult = {
  version?: number;
  coverAssetId?: string | null;
  detachedAssets?: unknown;
};

/**
 * 테마·포인트 색상·커버·홈 섹션을 한 번에 저장한다(CONTRACTS.md 5 `save_customization`).
 *
 * - 저장 값은 설정 스냅샷이다. 고정한 추억 ID는 들어가지 않는다(고정은 별도 저장이다).
 * - 버전이 이미 바뀌었으면 DB가 CONFLICT로 거부한다. 상대 저장을 덮어쓰지 않는다.
 * - 교체·해제된 이전 커버는 **DB 응답의 `detachedAssets`만** 정리한다. 정리에 실패해도
 *   설정 저장은 성공이며(`cleanup: 'pending'`), 실패로 뒤집어 알리지 않는다.
 */
export async function saveCustomizationAction(raw: unknown): Promise<CustomizeResult<SaveCustomizationData>> {
  const parsed = saveCustomizationInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return customizeFailure('VALIDATION_ERROR', first?.message);
  }
  const input = parsed.data;

  const session = await requireMemberSession();
  if (!session.ok) return session;
  const { client, spaceId } = session.member;

  const { data, error } = await client.rpc('save_customization', {
    p_theme_key: input.themeKey,
    p_accent_color: input.accentColor,
    p_cover_asset_id: input.coverAssetId,
    p_home_sections: toHomeSectionsPayload(input.sections),
    p_expected_version: input.expectedVersion,
    p_request_id: input.requestId,
  });

  if (error) {
    const failure = mapCustomizeRpcError(error);
    logCustomizeFailure('saveCustomization', failure.code, input.requestId);
    return failure;
  }

  const result = (data ?? {}) as SaveRpcResult;
  if (typeof result.version !== 'number') {
    logCustomizeFailure('saveCustomization', 'UNKNOWN', input.requestId);
    return customizeFailure('UNKNOWN');
  }

  const cleanup = await removeDeletingObjects(
    parseDetachedAssets(result.detachedAssets, spaceId),
    spaceId,
    'saveCustomization',
  );

  // 홈·껍데기(테마)·꾸미기 화면이 모두 이 설정을 읽는다. 이전 응답을 재사용하지 않도록 전부 비운다.
  revalidatePath('/', 'layout');

  return {
    ok: true,
    data: {
      version: result.version,
      coverAssetId: typeof result.coverAssetId === 'string' ? result.coverAssetId : null,
      cleanup,
    },
  };
}

// ---------------------------------------------------------------------------
// 커버 사진: 준비 → (브라우저가 정규화 후 표준 업로드 1회) → 읽기 전용 확정 / 취소
// ---------------------------------------------------------------------------

export async function prepareCoverPhotoAction(raw: unknown): Promise<CustomizeResult<PreparedCover>> {
  const parsed = prepareCoverInputSchema.safeParse(raw);
  if (!parsed.success) {
    // 거부 사유를 그대로 알린다. 용량 초과를 "지원하지 않는 형식"으로 안내하지 않는다.
    const failedField = parsed.error.issues[0]?.path[0];
    return customizeFailure(
      'VALIDATION_ERROR',
      failedField === 'bytes' ? PHOTO_REJECT_MESSAGES.too_large : PHOTO_REJECT_MESSAGES.unsupported_format,
    );
  }
  const input = parsed.data;

  // 확정할 수 없는 파일을 만들지 않는다. 설정이 없으면 커버 업로드만 꺼진다.
  if (!isPhotoPipelineConfigured()) return customizeFailure('PHOTOS_DISABLED');

  const session = await requireMemberSession();
  if (!session.ok) return session;
  const { client, spaceId } = session.member;

  const { data, error } = await client.rpc('prepare_upload', {
    p_purpose: COVER_PURPOSE,
    p_mime_type: input.mimeType,
    p_bytes: input.bytes,
    p_request_id: input.requestId,
  });

  if (error) {
    const failure = mapCustomizeRpcError(error);
    logCustomizeFailure('prepareCover', failure.code, input.requestId);
    return failure.code === 'VALIDATION_ERROR'
      ? customizeFailure('VALIDATION_ERROR', PHOTO_REJECT_MESSAGES.too_large)
      : failure;
  }

  const result = (data ?? {}) as { assetId?: unknown; bucket?: unknown; objectPath?: unknown };
  if (
    typeof result.assetId !== 'string' ||
    result.bucket !== COVER_BUCKET ||
    typeof result.objectPath !== 'string' ||
    !expectedObjectPath(spaceId, result.assetId, result.objectPath)
  ) {
    logCustomizeFailure('prepareCover', 'UNKNOWN', input.requestId);
    return customizeFailure('UNKNOWN');
  }

  return { ok: true, data: { assetId: result.assetId, bucket: result.bucket, objectPath: result.objectPath } };
}

async function loadVerifier(): Promise<((bytes: Uint8Array, mime: MemoryUploadMime) => Promise<VerifyResult>) | null> {
  try {
    return (await import('@/features/memories/server/image-verify')).verifyMemoryPhoto;
  } catch {
    console.error('customize.finalizeCover code=PHOTOS_DISABLED reason=decoder_unavailable');
    return null;
  }
}

/**
 * 커버 업로드 확정. 프로토콜은 추억과 같다(사용자 RLS 확인 → 읽기 전용 검증 → service RPC).
 * 용도를 `cover`로 **명시**하므로 추억용으로 올린 파일은 여기서 확정되지 않는다(NOT_FOUND).
 */
export async function finalizeCoverPhotoAction(raw: unknown): Promise<CustomizeResult<{ assetId: string }>> {
  const parsed = finalizeCoverInputSchema.safeParse(raw);
  if (!parsed.success) return customizeFailure('NOT_FOUND');

  const service = createServiceClient();
  if (!service) return customizeFailure('PHOTOS_DISABLED');

  const session = await requireMemberSession();
  if (!session.ok) return session;

  const verify = await loadVerifier();
  if (!verify) return customizeFailure('PHOTOS_DISABLED');

  return fromPhotoResult(
    await finalizeOwnedMemoryPhoto(
      {
        userClient: session.member.client,
        userId: session.member.userId,
        spaceId: session.member.spaceId,
        service,
        storageRequest: serviceStorageRequest,
        verify,
      },
      parsed.data.assetId,
      COVER_PURPOSE,
    ),
  );
}

/**
 * 아직 설정에 붙이지 않은 **자기** 커버 파일을 정리 대상으로 돌린다.
 * 이미 설정에 붙어 있는 커버는 DB(`discard_upload`)가 CONFLICT로 거부한다.
 * 저장된 커버가 취소 요청 하나로 사라지지 않는다.
 */
export async function discardCoverPhotoAction(
  raw: unknown,
): Promise<CustomizeResult<{ assetId: string; cleanup: 'none' | 'done' | 'pending' }>> {
  const parsed = discardCoverInputSchema.safeParse(raw);
  if (!parsed.success) return customizeFailure('NOT_FOUND');
  const input = parsed.data;

  const session = await requireMemberSession();
  if (!session.ok) return session;
  const { client, spaceId } = session.member;

  const { data, error } = await client.rpc('discard_upload', {
    p_asset_id: input.assetId,
    p_request_id: input.requestId,
  });
  if (error) {
    const failure = mapCustomizeRpcError(error);
    logCustomizeFailure('discardCover', failure.code, input.requestId);
    return failure;
  }

  const cleanup = await removeDeletingObjects(parseDetachedAssets([data], spaceId), spaceId, 'discardCover');
  return { ok: true, data: { assetId: input.assetId, cleanup } };
}
