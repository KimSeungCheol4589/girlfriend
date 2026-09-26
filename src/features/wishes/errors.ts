import {
  mapPostgrestError,
  messageForCode,
  parseErrorDetail,
  type ActionFailure,
  type AuthErrorCode,
  type FieldErrors,
  type PostgresErrorLike,
} from '@/features/auth/errors';

import { WISH_LIMITS } from './constants';
import { LINK_URL_MESSAGES } from './schema';

/**
 * 위시 RPC 오류를 화면 결과로 바꾼다.
 *
 * SQLSTATE → 코드 변환은 인증 기능의 공통 매핑(`mapPostgrestError`)을 그대로 쓰고,
 * 위시 필드 이름·문장만 여기서 정한다. DETAIL에는 필드 힌트만 들어 있다(CONTRACTS.md 0).
 * 사용자 입력·DB 원문은 메시지에 넣지 않는다.
 */

export type WishFailure = ActionFailure & {
  /** 기준 버전이 낡았다(그 사이 상대방이 무언가를 바꿨다). */
  stale?: boolean;
};

/** 폼에 붙일 수 있는 필드. 그 밖의 DETAIL 키는 상단 요약으로만 보여 준다. */
const FORM_FIELDS = new Set(['title', 'category', 'memo', 'linkUrl', 'status', 'plannedDate']);

const FIELD_MESSAGES: Record<string, string> = {
  'title:length': `제목은 ${WISH_LIMITS.titleMin}~${WISH_LIMITS.titleMax}자로 입력해 주세요.`,
  'category:allowed': '분류를 다시 골라 주세요.',
  'memo:length': `메모는 ${WISH_LIMITS.memoMax.toLocaleString('ko-KR')}자까지 쓸 수 있어요.`,
  'linkUrl:https_required': LINK_URL_MESSAGES.https_required,
  'linkUrl:length': LINK_URL_MESSAGES.length,
  'linkUrl:host_not_allowed': LINK_URL_MESSAGES.host_not_allowed,
  'status:allowed': '상태를 다시 골라 주세요.',
  'plannedDate:must_be_null': '하고 싶음으로 되돌릴 때는 계획한 날짜를 비워야 해요.',
};

const DETAILED_MESSAGES: Record<string, string> = {
  'CONFLICT:expectedVersion:stale':
    '상대방이 먼저 바꾼 내용이 있어 저장하지 않았어요. 입력한 내용은 그대로 두었으니 최신 내용을 확인한 뒤 다시 저장해 주세요.',
  'CONFLICT:requestId:payload_mismatch':
    '같은 요청 번호로 다른 내용을 보냈어요. 화면을 새로 불러온 뒤 다시 시도해 주세요.',
  /*
   * CAL-001에서 정한 삭제 의미. 연결된 캘린더 일정이 있으면 위시를 지우지 않고 거부한다.
   * 이 문장이 없으면 일반 CONFLICT 안내("최신 내용을 불러온 뒤 다시 시도")가 나가는데, 다시 시도해도
   * 결과가 같아 사용자가 원인을 모른 채 반복하게 된다.
   */
  'CONFLICT:wishId:has_calendar_events':
    '이 위시로 만든 캘린더 일정이 있어 지울 수 없어요. 캘린더에서 연결된 일정을 먼저 지우거나 일정의 위시 연결을 해제한 뒤 다시 시도해 주세요.',
  /*
   * DATE-001. 이 위시로 남긴 데이트 기록이 있으면 위시를 지우지 않고 거부한다(연쇄 삭제 금지).
   * 위시 상세의 "데이트 기록" 칸에 연결된 기록이 목록으로 보이므로, 무엇을 먼저 정리해야 하는지
   * 사용자가 바로 확인할 수 있다.
   */
  'CONFLICT:wishId:has_memories':
    '이 위시로 남긴 데이트 기록이 있어 지울 수 없어요. 아래 "데이트 기록"에서 연결을 해제하거나 그 기록을 먼저 지운 뒤 다시 시도해 주세요.',
  'RETRYABLE_ERROR:requestId:in_progress':
    '같은 요청을 처리하는 중이에요. 잠시 후 같은 내용으로 다시 시도해 주세요.',
  'NOT_FOUND:space:not_member': '공간에 참여한 계정만 위시를 다룰 수 있어요.',
};

const CODE_MESSAGES: Partial<Record<AuthErrorCode, string>> = {
  NOT_FOUND: '위시를 찾을 수 없어요. 이미 삭제됐거나 볼 수 없는 항목이에요.',
  UNKNOWN:
    '저장됐는지 확인하지 못했어요. 입력을 바꾸지 말고 같은 내용으로 다시 시도하면 중복 없이 처리돼요.',
  RETRYABLE_ERROR:
    '일시적인 문제로 처리하지 못했어요. 입력을 바꾸지 말고 같은 내용으로 다시 시도해 주세요.',
};

/**
 * 삭제처럼 "보고 확인한 내용"이 전제인 작업의 충돌 문장.
 * 확인 창을 연 뒤 상대가 정보나 상태를 바꿨으면 expectedVersion이 달라져 DB가 아무것도 바꾸지 않는다.
 */
export const CONFIRMED_ACTION_STALE_MESSAGE =
  '확인한 뒤에 위시가 바뀌어 아무것도 바꾸지 않았어요. 최신 내용을 불러왔으니 다시 확인해 주세요.';

export function confirmedActionMessage(failure: WishFailure): string {
  if (failure.code === 'CONFLICT' && failure.stale) return CONFIRMED_ACTION_STALE_MESSAGE;
  return failure.message;
}

export function wishFieldMessage(field: string, reason: string): string {
  return FIELD_MESSAGES[`${field}:${reason}`] ?? '입력을 다시 확인해 주세요.';
}

export function mapWishRpcError(error: PostgresErrorLike | null | undefined): WishFailure {
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

  const result: WishFailure = { ok: false, code, message: '' };

  if (code === 'VALIDATION_ERROR') {
    const formErrors: FieldErrors = {};
    for (const [field, reason] of Object.entries(hints)) {
      if (FORM_FIELDS.has(field)) formErrors[field] = wishFieldMessage(field, reason);
    }
    if (Object.keys(formErrors).length > 0) {
      result.fieldErrors = formErrors;
      message ??= Object.values(formErrors)[0];
    }
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
export function logWishFailure(operation: string, code: AuthErrorCode, requestId?: string): void {
  const parts = [`wishes.${operation}`, `code=${code}`];
  if (requestId) parts.push(`requestId=${requestId}`);
  console.error(parts.join(' '));
}

export function validationFailure(fieldErrors: FieldErrors): WishFailure {
  const first = Object.values(fieldErrors)[0];
  return {
    ok: false,
    code: 'VALIDATION_ERROR',
    message: first ?? messageForCode('VALIDATION_ERROR'),
    fieldErrors,
  };
}
