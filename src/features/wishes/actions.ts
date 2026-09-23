'use server';

import { revalidatePath } from 'next/cache';

import { isRequestId } from '@/features/auth/request-id';
import { validateWith } from '@/features/auth/schemas';
import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import { logWishFailure, mapWishRpcError, validationFailure, type WishFailure } from './errors';
import { isWishCursor, parseWishFilters } from './filters';
import { listWishes } from './queries';
import {
  deleteWishSchema,
  saveWishSchema,
  setWishStatusSchema,
  type DeleteWishInput,
  type SaveWishInput,
  type SetWishStatusInput,
} from './schema';

import type { WishStatus } from './constants';
import type { WishPageResult } from './types';

/**
 * 위시 Server Action.
 *
 * 공통 규칙(CONTRACTS.md 0·7)
 *   - 사용자·공간은 DB 함수가 세션으로 확인한다. 클라이언트가 보낸 사용자·공간 ID는 받지 않는다.
 *   - 입력은 여기서 다시 검증한다(화면 검증을 믿지 않는다). 최종 검증은 DB 함수가 한다.
 *   - 변경은 전용 RPC로만 한다. 요청 키(requestId)는 **클라이언트가 만든 값만** 쓴다.
 *     서버가 대신 만들면 재시도마다 키가 달라져 중복 반영을 막지 못한다.
 *   - 실패는 코드·문장으로 돌려주고, 로그에는 작업 이름·코드·요청 키만 남긴다.
 */

export type WishActionResult<T> = { ok: true; data: T } | WishFailure;

type WithRequestId<T> = T & { requestId: string };

const CONFIG_FAILURE: WishFailure = {
  ok: false,
  code: 'CONFIG_ERROR',
  message: '서버 설정이 없어 저장할 수 없어요. 운영자에게 알려 주세요.',
};

const BAD_REQUEST_ID: WishFailure = {
  ok: false,
  code: 'VALIDATION_ERROR',
  message: '요청 정보가 올바르지 않아요. 화면을 새로 불러온 뒤 다시 시도해 주세요.',
};

async function getClient() {
  try {
    return await createSupabaseServerClient();
  } catch (error) {
    if (isSupabaseConfigError(error)) return null;
    throw error;
  }
}

type RpcCall = {
  operation: string;
  fn: string;
  args: Record<string, unknown>;
  requestId: string;
};

async function callRpc(call: RpcCall): Promise<{ ok: true; data: Record<string, unknown> } | WishFailure> {
  const supabase = await getClient();
  if (!supabase) return CONFIG_FAILURE;

  let response: { data: unknown; error: { code?: string; message?: string; details?: string } | null };
  try {
    response = await supabase.rpc(call.fn, call.args);
  } catch {
    // 네트워크 예외: 서버가 처리했는지 모른다. 같은 키로 다시 보내야 한다.
    const failure = mapWishRpcError({ code: '' });
    logWishFailure(call.operation, failure.code, call.requestId);
    return failure;
  }

  if (response.error) {
    const failure = mapWishRpcError(response.error);
    logWishFailure(call.operation, failure.code, call.requestId);
    return failure;
  }

  const data = response.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    // 계약과 다른 응답. 저장 여부를 단정하지 않는다.
    const failure = mapWishRpcError({ code: '' });
    logWishFailure(call.operation, 'UNKNOWN', call.requestId);
    return failure;
  }
  return { ok: true, data: data as Record<string, unknown> };
}

function revalidateWishes(): void {
  revalidatePath('/wishes', 'layout');
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// ---------------------------------------------------------------------------
// 위시 정보 (생성·수정)
// ---------------------------------------------------------------------------

export async function saveWishAction(
  input: WithRequestId<SaveWishInput>,
): Promise<WishActionResult<{ wishId: string; version: number }>> {
  if (!isRequestId(input?.requestId)) return BAD_REQUEST_ID;
  const parsed = validateWith(saveWishSchema, input);
  if (!parsed.ok) return validationFailure(parsed.fieldErrors);
  const value = parsed.data;

  if (value.wishId === null && value.expectedVersion !== 0) {
    return validationFailure({ _form: '새 위시는 버전 0으로 만들어야 해요.' });
  }

  const result = await callRpc({
    operation: 'saveWish',
    fn: 'save_wish',
    requestId: input.requestId,
    args: {
      p_wish_id: value.wishId,
      p_title: value.title,
      p_category: value.category,
      p_memo: value.memo,
      p_link_url: value.linkUrl,
      p_expected_version: value.expectedVersion,
      p_request_id: input.requestId,
    },
  });
  if (!result.ok) return result;

  const wishId = text(result.data.wishId);
  const version = num(result.data.version);
  if (!wishId || version === null) {
    logWishFailure('saveWish', 'UNKNOWN', input.requestId);
    return mapWishRpcError({ code: '' });
  }

  revalidateWishes();
  return { ok: true, data: { wishId, version } };
}

// ---------------------------------------------------------------------------
// 상태·계획일
// ---------------------------------------------------------------------------

export async function setWishStatusAction(
  input: WithRequestId<SetWishStatusInput>,
): Promise<WishActionResult<{ version: number; status: WishStatus; plannedDate: string | null }>> {
  if (!isRequestId(input?.requestId)) return BAD_REQUEST_ID;
  const parsed = validateWith(setWishStatusSchema, input);
  if (!parsed.ok) return validationFailure(parsed.fieldErrors);
  const value = parsed.data;

  const result = await callRpc({
    operation: 'setWishStatus',
    fn: 'set_wish_status',
    requestId: input.requestId,
    args: {
      p_wish_id: value.wishId,
      p_status: value.status,
      // 'wish'로 되돌릴 때는 DB도 계획일을 비운다. 여기서도 분명히 null을 보낸다.
      p_planned_date: value.status === 'wish' ? null : value.plannedDate,
      p_expected_version: value.expectedVersion,
      p_request_id: input.requestId,
    },
  });
  if (!result.ok) return result;

  const version = num(result.data.version);
  const status = text(result.data.status);
  if (version === null || (status !== 'wish' && status !== 'planned' && status !== 'done')) {
    logWishFailure('setWishStatus', 'UNKNOWN', input.requestId);
    return mapWishRpcError({ code: '' });
  }

  revalidateWishes();
  return { ok: true, data: { version, status, plannedDate: text(result.data.plannedDate) } };
}

// ---------------------------------------------------------------------------
// 삭제
// ---------------------------------------------------------------------------

export async function deleteWishAction(
  input: WithRequestId<DeleteWishInput>,
): Promise<WishActionResult<{ wishId: string }>> {
  if (!isRequestId(input?.requestId)) return BAD_REQUEST_ID;
  const parsed = validateWith(deleteWishSchema, input);
  if (!parsed.ok) return validationFailure(parsed.fieldErrors);
  const value = parsed.data;

  const result = await callRpc({
    operation: 'deleteWish',
    fn: 'delete_wish',
    requestId: input.requestId,
    args: {
      p_wish_id: value.wishId,
      p_expected_version: value.expectedVersion,
      p_request_id: input.requestId,
    },
  });
  if (!result.ok) return result;

  revalidateWishes();
  return { ok: true, data: { wishId: value.wishId } };
}

// ---------------------------------------------------------------------------
// 목록 더 보기
// ---------------------------------------------------------------------------

export async function loadMoreWishesAction(input: {
  filters: Record<string, string | undefined>;
  cursor: unknown;
}): Promise<WishPageResult> {
  if (!isWishCursor(input?.cursor)) {
    return { ok: false, message: '목록 위치 정보가 올바르지 않아요. 목록을 처음부터 다시 불러와 주세요.' };
  }
  const filters = parseWishFilters(input.filters ?? {});
  return listWishes(filters, input.cursor);
}
