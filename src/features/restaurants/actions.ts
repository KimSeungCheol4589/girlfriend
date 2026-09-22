'use server';

import { revalidatePath } from 'next/cache';

import { isRequestId } from '@/features/auth/request-id';
import { validateWith } from '@/features/auth/schemas';
import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import {
  logRestaurantFailure,
  mapRestaurantRpcError,
  validationFailure,
  type RestaurantFailure,
} from './errors';
import { isRestaurantCursor, parseRestaurantFilters } from './filters';
import { listRestaurants } from './queries';
import {
  deleteRestaurantSchema,
  deleteReviewSchema,
  saveRestaurantSchema,
  saveReviewSchema,
  setStatusSchema,
  type DeleteRestaurantInput,
  type DeleteReviewInput,
  type SaveRestaurantInput,
  type SaveReviewInput,
  type SetStatusInput,
} from './schema';

import type { RestaurantStatus } from './constants';
import type { RestaurantPageResult } from './types';

/**
 * 맛집·후기 Server Action.
 *
 * 공통 규칙(CONTRACTS.md 0·7)
 *   - 사용자·공간은 DB 함수가 세션으로 확인한다. 클라이언트가 보낸 사용자·공간 ID는 받지 않는다.
 *   - 입력은 여기서 다시 검증한다(화면 검증을 믿지 않는다). 최종 검증은 DB 함수가 한다.
 *   - 변경은 전용 RPC로만 한다. 요청 키(requestId)는 **클라이언트가 만든 값만** 쓴다.
 *     서버가 대신 만들면 재시도마다 키가 달라져 중복 반영을 막지 못한다.
 *   - 실패는 코드·문장으로 돌려주고, 로그에는 작업 이름·코드·요청 키만 남긴다.
 */

export type RestaurantActionResult<T> = { ok: true; data: T } | RestaurantFailure;

type WithRequestId<T> = T & { requestId: string };

const CONFIG_FAILURE: RestaurantFailure = {
  ok: false,
  code: 'CONFIG_ERROR',
  message: '서버 설정이 없어 저장할 수 없어요. 운영자에게 알려 주세요.',
};

const BAD_REQUEST_ID: RestaurantFailure = {
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

async function callRpc(call: RpcCall): Promise<{ ok: true; data: Record<string, unknown> } | RestaurantFailure> {
  const supabase = await getClient();
  if (!supabase) return CONFIG_FAILURE;

  let response: { data: unknown; error: { code?: string; message?: string; details?: string } | null };
  try {
    response = await supabase.rpc(call.fn, call.args);
  } catch {
    // 네트워크 예외: 서버가 처리했는지 모른다. 같은 키로 다시 보내야 한다.
    const failure = mapRestaurantRpcError({ code: '' });
    logRestaurantFailure(call.operation, failure.code, call.requestId);
    return failure;
  }

  if (response.error) {
    const failure = mapRestaurantRpcError(response.error);
    logRestaurantFailure(call.operation, failure.code, call.requestId);
    return failure;
  }

  const data = response.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    // 계약과 다른 응답. 저장 여부를 단정하지 않는다.
    const failure = mapRestaurantRpcError({ code: '' });
    logRestaurantFailure(call.operation, 'UNKNOWN', call.requestId);
    return failure;
  }
  return { ok: true, data: data as Record<string, unknown> };
}

function revalidateRestaurants(): void {
  revalidatePath('/restaurants', 'layout');
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// ---------------------------------------------------------------------------
// 맛집 정보 (생성·수정)
// ---------------------------------------------------------------------------

export async function saveRestaurantAction(
  input: WithRequestId<SaveRestaurantInput>,
): Promise<RestaurantActionResult<{ restaurantId: string; version: number }>> {
  if (!isRequestId(input?.requestId)) return BAD_REQUEST_ID;
  const parsed = validateWith(saveRestaurantSchema, input);
  if (!parsed.ok) return validationFailure(parsed.fieldErrors);
  const value = parsed.data;

  if (value.restaurantId === null && value.expectedVersion !== 0) {
    return validationFailure({ _form: '새 맛집은 버전 0으로 만들어야 해요.' });
  }

  const result = await callRpc({
    operation: 'saveRestaurant',
    fn: 'save_restaurant',
    requestId: input.requestId,
    args: {
      p_restaurant_id: value.restaurantId,
      p_name: value.name,
      p_area: value.area,
      p_category: value.category,
      p_map_url: value.mapUrl,
      p_memo: value.memo,
      p_expected_version: value.expectedVersion,
      p_request_id: input.requestId,
    },
  });
  if (!result.ok) return result;

  const restaurantId = text(result.data.restaurantId);
  const version = num(result.data.version);
  if (!restaurantId || version === null) {
    logRestaurantFailure('saveRestaurant', 'UNKNOWN', input.requestId);
    return mapRestaurantRpcError({ code: '' });
  }

  revalidateRestaurants();
  return { ok: true, data: { restaurantId, version } };
}

// ---------------------------------------------------------------------------
// 방문 상태·방문일
// ---------------------------------------------------------------------------

export async function setRestaurantStatusAction(input: WithRequestId<SetStatusInput>): Promise<
  RestaurantActionResult<{
    version: number;
    status: RestaurantStatus;
    visitedDate: string | null;
    deletedReviewCount: number;
  }>
> {
  if (!isRequestId(input?.requestId)) return BAD_REQUEST_ID;
  const parsed = validateWith(setStatusSchema, input);
  if (!parsed.ok) return validationFailure(parsed.fieldErrors);
  const value = parsed.data;

  const result = await callRpc({
    operation: 'setRestaurantStatus',
    fn: 'set_restaurant_status',
    requestId: input.requestId,
    args: {
      p_restaurant_id: value.restaurantId,
      p_status: value.status,
      p_visited_date: value.status === 'visited' ? value.visitedDate : null,
      p_confirm_delete_reviews: value.confirmDeleteReviews,
      p_expected_version: value.expectedVersion,
      p_request_id: input.requestId,
    },
  });
  if (!result.ok) return result;

  const version = num(result.data.version);
  const status = text(result.data.status);
  if (version === null || (status !== 'wishlist' && status !== 'visited')) {
    logRestaurantFailure('setRestaurantStatus', 'UNKNOWN', input.requestId);
    return mapRestaurantRpcError({ code: '' });
  }

  revalidateRestaurants();
  return {
    ok: true,
    data: {
      version,
      status,
      visitedDate: text(result.data.visitedDate),
      deletedReviewCount: num(result.data.deletedReviewCount) ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// 맛집 삭제 (후기 삭제 확인 필수)
// ---------------------------------------------------------------------------

export async function deleteRestaurantAction(
  input: WithRequestId<DeleteRestaurantInput>,
): Promise<RestaurantActionResult<{ deletedReviewCount: number }>> {
  if (!isRequestId(input?.requestId)) return BAD_REQUEST_ID;
  const parsed = validateWith(deleteRestaurantSchema, input);
  if (!parsed.ok) return validationFailure(parsed.fieldErrors);
  const value = parsed.data;

  // 확인 없는 이전 delete_restaurant는 쓰지 않는다(FOOD-001 마이그레이션에서 실행 권한 회수).
  const result = await callRpc({
    operation: 'deleteRestaurant',
    fn: 'delete_restaurant_confirmed',
    requestId: input.requestId,
    args: {
      p_restaurant_id: value.restaurantId,
      p_confirm_delete_reviews: value.confirmDeleteReviews,
      p_expected_version: value.expectedVersion,
      p_request_id: input.requestId,
    },
  });
  if (!result.ok) return result;

  revalidateRestaurants();
  return { ok: true, data: { deletedReviewCount: num(result.data.deletedReviewCount) ?? 0 } };
}

// ---------------------------------------------------------------------------
// 개인 후기 (본인 것만)
// ---------------------------------------------------------------------------

export async function saveReviewAction(
  input: WithRequestId<SaveReviewInput>,
): Promise<RestaurantActionResult<{ reviewId: string; version: number }>> {
  if (!isRequestId(input?.requestId)) return BAD_REQUEST_ID;
  const parsed = validateWith(saveReviewSchema, input);
  if (!parsed.ok) return validationFailure(parsed.fieldErrors);
  const value = parsed.data;

  const result = await callRpc({
    operation: 'saveReview',
    fn: 'save_review',
    requestId: input.requestId,
    args: {
      p_restaurant_id: value.restaurantId,
      p_rating: value.rating,
      p_comment: value.comment,
      p_expected_version: value.expectedVersion,
      p_request_id: input.requestId,
    },
  });
  if (!result.ok) return result;

  const reviewId = text(result.data.reviewId);
  const version = num(result.data.version);
  if (!reviewId || version === null) {
    logRestaurantFailure('saveReview', 'UNKNOWN', input.requestId);
    return mapRestaurantRpcError({ code: '' });
  }

  revalidateRestaurants();
  return { ok: true, data: { reviewId, version } };
}

export async function deleteReviewAction(
  input: WithRequestId<DeleteReviewInput>,
): Promise<RestaurantActionResult<{ reviewId: string }>> {
  if (!isRequestId(input?.requestId)) return BAD_REQUEST_ID;
  const parsed = validateWith(deleteReviewSchema, input);
  if (!parsed.ok) return validationFailure(parsed.fieldErrors);
  const value = parsed.data;

  const result = await callRpc({
    operation: 'deleteReview',
    fn: 'delete_review',
    requestId: input.requestId,
    args: {
      p_review_id: value.reviewId,
      p_expected_version: value.expectedVersion,
      p_request_id: input.requestId,
    },
  });
  if (!result.ok) return result;

  revalidateRestaurants();
  return { ok: true, data: { reviewId: value.reviewId } };
}

// ---------------------------------------------------------------------------
// 목록 더 보기
// ---------------------------------------------------------------------------

export async function loadMoreRestaurantsAction(input: {
  filters: Record<string, string | undefined>;
  cursor: unknown;
}): Promise<RestaurantPageResult> {
  if (!isRestaurantCursor(input?.cursor)) {
    return { ok: false, message: '목록 위치 정보가 올바르지 않아요. 목록을 처음부터 다시 불러와 주세요.' };
  }
  const filters = parseRestaurantFilters(input.filters ?? {});
  return listRestaurants(filters, input.cursor);
}
