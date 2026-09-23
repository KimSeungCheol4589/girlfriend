import {
  mapPostgrestError,
  messageForCode,
  parseErrorDetail,
  type ActionFailure,
  type AuthErrorCode,
  type FieldErrors,
  type PostgresErrorLike,
} from '@/features/auth/errors';

import { MAP_URL_MESSAGES } from './schema';
import { RESTAURANT_LIMITS } from './constants';

/**
 * 맛집 RPC 오류를 화면 결과로 바꾼다.
 *
 * SQLSTATE → 코드 변환은 인증 기능의 공통 매핑(`mapPostgrestError`)을 그대로 쓰고,
 * 맛집 필드 이름·문장만 여기서 정한다. DETAIL에는 필드 힌트만 들어 있다(CONTRACTS.md 0).
 * 사용자 입력·DB 원문은 메시지에 넣지 않는다.
 */

export type RestaurantFailure = ActionFailure & {
  /** 후기 삭제 확인이 필요해 아무것도 바뀌지 않았다(다시 확인을 받아야 한다). */
  needsReviewConfirmation?: boolean;
  /** 맛집이 방문 완료 상태가 아니라 후기를 저장하지 못했다. */
  notVisited?: boolean;
  /** 기준 버전이 낡았다(정보·상태·후기 중 무엇이든 그 사이 바뀌었다). */
  stale?: boolean;
};

/** 폼에 붙일 수 있는 필드. 그 밖의 DETAIL 키는 상단 요약으로만 보여 준다. */
const FORM_FIELDS = new Set(['name', 'area', 'category', 'mapUrl', 'memo', 'visitedDate', 'rating', 'comment']);

const FIELD_MESSAGES: Record<string, string> = {
  'name:length': `이름은 1~${RESTAURANT_LIMITS.nameMax}자로 입력해 주세요.`,
  'area:length': `지역은 ${RESTAURANT_LIMITS.areaMax}자까지 쓸 수 있어요.`,
  'category:length': `음식 종류는 ${RESTAURANT_LIMITS.categoryMax}자까지 쓸 수 있어요.`,
  'memo:length': `메모는 ${RESTAURANT_LIMITS.memoMax.toLocaleString('ko-KR')}자까지 쓸 수 있어요.`,
  'mapUrl:https_required': MAP_URL_MESSAGES.https_required,
  'mapUrl:length': MAP_URL_MESSAGES.length,
  'mapUrl:host_not_allowed': MAP_URL_MESSAGES.host_not_allowed,
  'visitedDate:future_date': '방문일은 오늘보다 뒤일 수 없어요.',
  'visitedDate:must_be_null': '가고 싶은 곳으로 돌릴 때는 방문일을 비워야 해요.',
  'rating:range': '별점은 1~5점 중에서 골라 주세요.',
  'comment:length': `한 줄 후기는 ${RESTAURANT_LIMITS.reviewCommentMax}자까지 쓸 수 있어요.`,
};

const DETAILED_MESSAGES: Record<string, string> = {
  'CONFLICT:expectedVersion:stale':
    '상대방이 먼저 바꾼 내용(정보·방문 상태·후기)이 있어 저장하지 않았어요. 입력한 내용은 그대로 두었으니 최신 내용을 확인한 뒤 다시 저장해 주세요.',
  'CONFLICT:confirmDeleteReviews:required':
    '그 사이 후기가 생겨 아무것도 바꾸지 않았어요. 함께 지워질 후기를 확인한 뒤 다시 진행해 주세요.',
  'CONFLICT:restaurant:not_visited':
    '방문 완료 상태가 아니라 후기를 저장하지 못했어요. 상대방이 방문을 취소했을 수 있어요. 최신 내용을 불러와 주세요.',
  'CONFLICT:requestId:payload_mismatch':
    '같은 요청 번호로 다른 내용을 보냈어요. 화면을 새로 불러온 뒤 다시 시도해 주세요.',
  'RETRYABLE_ERROR:requestId:in_progress':
    '같은 요청을 처리하는 중이에요. 잠시 후 같은 내용으로 다시 시도해 주세요.',
  'NOT_FOUND:space:not_member': '공간에 참여한 계정만 맛집을 다룰 수 있어요.',
};

const CODE_MESSAGES: Partial<Record<AuthErrorCode, string>> = {
  NOT_FOUND: '맛집이나 후기를 찾을 수 없어요. 이미 삭제됐거나 볼 수 없는 항목이에요.',
  UNKNOWN:
    '저장됐는지 확인하지 못했어요. 입력을 바꾸지 말고 같은 내용으로 다시 시도하면 중복 없이 처리돼요.',
  RETRYABLE_ERROR:
    '일시적인 문제로 처리하지 못했어요. 입력을 바꾸지 말고 같은 내용으로 다시 시도해 주세요.',
};

/**
 * 방문 취소·맛집 삭제처럼 "보고 확인한 후기"가 전제인 작업의 충돌 문장.
 * 후기 저장·수정·삭제는 맛집 버전을 올리므로(FOOD-001 마이그레이션 2), 확인 창을 연 뒤 후기가 생기거나
 * 바뀌거나 지워졌으면 expectedVersion이 달라져 DB가 아무것도 바꾸지 않는다.
 */
export const CONFIRMED_ACTION_STALE_MESSAGE =
  '확인한 뒤에 맛집 정보나 후기가 바뀌어 아무것도 바꾸지 않았어요. 최신 내용을 불러왔으니 함께 지워질 후기를 다시 확인해 주세요.';

/** 확인형 작업(방문 취소·삭제)의 실패 문장. 버전 충돌이면 위 문장으로 바꾼다. */
export function confirmedActionMessage(failure: RestaurantFailure): string {
  if (failure.code === 'CONFLICT' && failure.stale) return CONFIRMED_ACTION_STALE_MESSAGE;
  return failure.message;
}

export function restaurantFieldMessage(field: string, reason: string): string {
  return FIELD_MESSAGES[`${field}:${reason}`] ?? '입력을 다시 확인해 주세요.';
}

export function mapRestaurantRpcError(error: PostgresErrorLike | null | undefined): RestaurantFailure {
  const base = mapPostgrestError(error);
  const { fieldErrors: hints } = parseErrorDetail(error?.details ?? null);
  const code = base.code;

  let message: string | undefined;
  for (const [field, reason] of Object.entries(hints)) {
    const detailed = DETAILED_MESSAGES[`${code}:${field}:${reason}`];
    if (detailed) {
      message = detailed;
      break;
    }
  }

  const result: RestaurantFailure = { ok: false, code, message: '' };

  if (code === 'VALIDATION_ERROR') {
    const formErrors: FieldErrors = {};
    for (const [field, reason] of Object.entries(hints)) {
      if (FORM_FIELDS.has(field)) formErrors[field] = restaurantFieldMessage(field, reason);
    }
    if (Object.keys(formErrors).length > 0) {
      result.fieldErrors = formErrors;
      message ??= Object.values(formErrors)[0];
    }
  }

  if (code === 'CONFLICT' && hints.confirmDeleteReviews === 'required') {
    result.needsReviewConfirmation = true;
  }
  if (code === 'CONFLICT' && hints.restaurant === 'not_visited') {
    result.notVisited = true;
  }
  if (code === 'CONFLICT' && hints.expectedVersion === 'stale') {
    result.stale = true;
  }

  result.message = message ?? CODE_MESSAGES[code] ?? messageForCode(code);
  if (base.diagnostics) result.diagnostics = base.diagnostics;
  return result;
}

/**
 * 서버가 결과를 확정해 줬는지.
 *
 * - 확정: 성공, 입력 오류, 충돌, 없음, 인증 필요 → 같은 요청 키를 다시 쓸 이유가 없다.
 * - 불확실: 재시도 가능·원인 불명 → 서버가 처리했는지 모른다. **같은 키·같은 입력**으로 다시 보내야
 *   한 번만 반영된다(CONTRACTS.md 7-1).
 */
export function isDefinitiveCode(code: AuthErrorCode): boolean {
  return code !== 'RETRYABLE_ERROR' && code !== 'UNKNOWN';
}

/** 서버 로그. 작업 이름·오류 코드·요청 키만 남긴다(DESIGN 11). 사용자 입력은 넣지 않는다. */
export function logRestaurantFailure(operation: string, code: AuthErrorCode, requestId?: string): void {
  const parts = [`restaurants.${operation}`, `code=${code}`];
  if (requestId) parts.push(`requestId=${requestId}`);
  console.error(parts.join(' '));
}

export function validationFailure(fieldErrors: FieldErrors): RestaurantFailure {
  const first = Object.values(fieldErrors)[0];
  return {
    ok: false,
    code: 'VALIDATION_ERROR',
    message: first ?? messageForCode('VALIDATION_ERROR'),
    fieldErrors,
  };
}
