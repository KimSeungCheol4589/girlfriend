import {
  mapPostgrestError,
  messageForCode,
  parseErrorDetail,
  type ActionFailure,
  type AuthErrorCode,
  type FieldErrors,
  type PostgresErrorLike,
} from '@/features/auth/errors';

import { CALENDAR_LIMITS } from './constants';

/**
 * 캘린더 RPC 오류를 화면 결과로 바꾼다.
 *
 * SQLSTATE → 코드 변환은 인증 기능의 공통 매핑(`mapPostgrestError`)을 그대로 쓰고,
 * 일정 필드 이름·문장만 여기서 정한다. DETAIL에는 필드 힌트만 들어 있다(CONTRACTS.md 0).
 * 사용자 입력·DB 원문은 메시지에 넣지 않는다.
 */

export type CalendarFailure = ActionFailure & {
  /** 기준 버전이 낡았다(그 사이 상대방이 무언가를 바꿨다). */
  stale?: boolean;
  /** 상대방의 개인 일정이라 바꿀 수 없다. 재시도해도 결과가 같다. */
  notOwner?: boolean;
};

/** 폼에 붙일 수 있는 필드. 그 밖의 DETAIL 키는 상단 요약으로만 보여 준다. */
const FORM_FIELDS = new Set([
  'kind',
  'title',
  'location',
  'note',
  'startDate',
  'startTime',
  'endDate',
  'endTime',
  'wishItemId',
  'status',
]);

const FIELD_MESSAGES: Record<string, string> = {
  'kind:allowed': '일정 종류를 다시 골라 주세요.',
  'kind:immutable':
    '개인 일정과 함께하는 일정은 서로 바꿀 수 없어요. 바꾸려면 새 일정으로 만들어 주세요.',
  'title:length': `제목은 ${CALENDAR_LIMITS.titleMin}~${CALENDAR_LIMITS.titleMax}자로 입력해 주세요.`,
  'location:length': `장소는 ${CALENDAR_LIMITS.locationMax}자까지 쓸 수 있어요.`,
  'note:length': `메모는 ${CALENDAR_LIMITS.noteMax.toLocaleString('ko-KR')}자까지 쓸 수 있어요.`,
  'startDate:required': '시작 날짜를 골라 주세요.',
  'startDate:all_day_must_be_midnight': '종일 일정의 시작은 그날 0시여야 해요. 다시 골라 주세요.',
  'startTime:required': '시작 시각을 골라 주세요.',
  'startTime:must_be_null_for_all_day': '종일 일정에는 시각을 넣지 않아요.',
  'endDate:required_for_all_day': '종일 일정에는 끝나는 날짜가 필요해요.',
  'endDate:before_start': '끝나는 날짜는 시작 날짜보다 앞일 수 없어요.',
  'endDate:all_day_must_be_midnight': '종일 일정의 종료는 그날 0시여야 해요. 다시 골라 주세요.',
  'endTime:required': '끝나는 시각도 함께 골라 주세요.',
  'endTime:must_be_null_for_all_day': '종일 일정에는 시각을 넣지 않아요.',
  'endTime:not_after_start': '끝나는 시각은 시작보다 뒤여야 해요.',
  'status:allowed': '상태를 다시 골라 주세요.',
  'wishItemId:missing': '고른 위시를 찾을 수 없어요. 목록을 새로 불러온 뒤 다시 골라 주세요.',
  'wishItemId:gone': '연결하려던 위시가 방금 사라졌어요. 연결을 비우거나 다른 위시를 골라 주세요.',
};

const DETAILED_MESSAGES: Record<string, string> = {
  'FORBIDDEN:ownerId:not_owner':
    '상대방의 개인 일정이라 바꿀 수 없어요. 상대 개인 일정은 보기만 할 수 있고, 함께하는 일정은 두 사람 모두 고칠 수 있어요.',
  'CONFLICT:expectedVersion:stale':
    '상대방이 먼저 바꾼 내용이 있어 저장하지 않았어요. 입력한 내용은 그대로 두었으니 최신 내용을 확인한 뒤 다시 저장해 주세요.',
  'CONFLICT:requestId:payload_mismatch':
    '같은 요청 번호로 다른 내용을 보냈어요. 화면을 새로 불러온 뒤 다시 시도해 주세요.',
  'CONFLICT:wishItemId:gone':
    '연결하려던 위시가 방금 사라졌어요. 위시 연결을 비우거나 다른 위시를 고른 뒤 다시 저장해 주세요.',
  /*
   * DATE-001. 이 일정으로 남긴 데이트 기록이 있으면 일정을 지우지 않고 거부한다(연쇄 삭제 금지).
   * 완료한 일정은 기록의 출처로 남아야 하므로, 기록을 먼저 정리하게 안내한다.
   */
  'CONFLICT:eventId:has_memories':
    '이 일정으로 남긴 데이트 기록이 있어 지울 수 없어요. 아래 "데이트 기록"에서 연결을 해제하거나 그 기록을 먼저 지운 뒤 다시 시도해 주세요.',
  'RETRYABLE_ERROR:requestId:in_progress':
    '같은 요청을 처리하는 중이에요. 잠시 후 같은 내용으로 다시 시도해 주세요.',
  'NOT_FOUND:space:not_member': '공간에 참여한 계정만 일정을 다룰 수 있어요.',
  'NOT_FOUND:wishItemId:missing':
    '고른 위시를 찾을 수 없어요. 이미 지워졌을 수 있어요. 목록을 새로 불러온 뒤 다시 골라 주세요.',
};

const CODE_MESSAGES: Partial<Record<AuthErrorCode, string>> = {
  NOT_FOUND: '일정을 찾을 수 없어요. 이미 삭제됐거나 볼 수 없는 일정이에요.',
  FORBIDDEN: '이 일정을 바꿀 권한이 없어요.',
  UNKNOWN:
    '저장됐는지 확인하지 못했어요. 입력을 바꾸지 말고 같은 내용으로 다시 시도하면 중복 없이 처리돼요.',
  RETRYABLE_ERROR:
    '일시적인 문제로 처리하지 못했어요. 입력을 바꾸지 말고 같은 내용으로 다시 시도해 주세요.',
};

/**
 * 삭제처럼 "보고 확인한 내용"이 전제인 작업의 충돌 문장.
 * 확인 창을 연 뒤 상대가 내용이나 상태를 바꿨으면 expectedVersion이 달라져 DB가 아무것도 바꾸지 않는다.
 */
export const CONFIRMED_ACTION_STALE_MESSAGE =
  '확인한 뒤에 일정이 바뀌어 아무것도 바꾸지 않았어요. 최신 내용을 불러왔으니 다시 확인해 주세요.';

export function confirmedActionMessage(failure: CalendarFailure): string {
  if (failure.code === 'CONFLICT' && failure.stale) return CONFIRMED_ACTION_STALE_MESSAGE;
  return failure.message;
}

export function calendarFieldMessage(field: string, reason: string): string {
  return FIELD_MESSAGES[`${field}:${reason}`] ?? '입력을 다시 확인해 주세요.';
}

export function mapCalendarRpcError(error: PostgresErrorLike | null | undefined): CalendarFailure {
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

  const result: CalendarFailure = { ok: false, code, message: '' };

  if (code === 'VALIDATION_ERROR') {
    const formErrors: FieldErrors = {};
    for (const [field, reason] of Object.entries(hints)) {
      if (FORM_FIELDS.has(field)) formErrors[field] = calendarFieldMessage(field, reason);
    }
    if (Object.keys(formErrors).length > 0) {
      result.fieldErrors = formErrors;
      message ??= Object.values(formErrors)[0];
    }
  }

  if (code === 'CONFLICT' && hints.expectedVersion === 'stale') {
    result.stale = true;
  }
  if (code === 'FORBIDDEN' && hints.ownerId === 'not_owner') {
    result.notOwner = true;
  }

  result.message = message ?? CODE_MESSAGES[code] ?? messageForCode(code);
  if (base.diagnostics) result.diagnostics = base.diagnostics;
  return result;
}

/**
 * 서버가 결과를 확정해 줬는지.
 *
 * - 확정: 성공, 입력 오류, 충돌, 없음, 권한 없음, 인증 필요 → 같은 요청 키를 다시 쓸 이유가 없다.
 * - 불확실: 재시도 가능·원인 불명 → 서버가 처리했는지 모른다. **같은 키·같은 입력**으로 다시 보내야
 *   한 번만 반영된다(CONTRACTS.md 7-1).
 */
export function isDefinitiveCode(code: AuthErrorCode): boolean {
  return code !== 'RETRYABLE_ERROR' && code !== 'UNKNOWN';
}

/** 서버 로그. 작업 이름·오류 코드·요청 키만 남긴다(DESIGN 11). 사용자 입력은 넣지 않는다. */
export function logCalendarFailure(
  operation: string,
  code: AuthErrorCode,
  requestId?: string,
): void {
  const parts = [`calendar.${operation}`, `code=${code}`];
  if (requestId) parts.push(`requestId=${requestId}`);
  console.error(parts.join(' '));
}

export function validationFailure(fieldErrors: FieldErrors): CalendarFailure {
  const first = Object.values(fieldErrors)[0];
  return {
    ok: false,
    code: 'VALIDATION_ERROR',
    message: first ?? messageForCode('VALIDATION_ERROR'),
    fieldErrors,
  };
}
