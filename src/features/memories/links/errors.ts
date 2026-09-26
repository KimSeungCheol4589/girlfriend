import { parseErrorDetail, type PostgresErrorLike } from '@/features/auth/errors';

import {
  MEMORY_CODE_MESSAGES,
  type MemoryActionFailure,
  type MemoryErrorCode,
} from '../live/errors';

/**
 * 연결 RPC의 결과·오류 계약.
 *
 * CONTRACTS.md 0: 분기는 **SQLSTATE로만** 한다. 메시지 문자열을 파싱하지 않는다.
 * 추억 기능과 같은 오류 코드 집합(`MemoryErrorCode`)을 쓰되, 문장은 "연결" 문맥으로 바꾼다.
 * 사용자 본문·제목은 어떤 로그에도 넣지 않는다(작업명·코드·요청 ID만).
 */

const SQLSTATE_TO_CODE: Record<string, MemoryErrorCode> = {
  GF401: 'UNAUTHENTICATED',
  // 연결 작업에서 FORBIDDEN이 나오면 설정 문제다. 권한 구조를 사용자에게 설명하지 않는다.
  GF403: 'UNKNOWN',
  GF404: 'NOT_FOUND',
  GF409: 'CONFLICT',
  GF422: 'VALIDATION_ERROR',
  GF503: 'RETRYABLE_ERROR',
  '42501': 'NOT_FOUND',
  // 복합 FK 위반이 사용자에게 보이는 경로는 RPC가 이미 도메인 오류로 바꾼다.
  // 그래도 남는 경우를 일반 충돌로 둔다(무한 재시도를 안내하지 않기 위해).
  '23503': 'CONFLICT',
  '23505': 'CONFLICT',
  PGRST301: 'UNAUTHENTICATED',
  PGRST302: 'UNAUTHENTICATED',
};

export const LINK_CODE_MESSAGES: Record<MemoryErrorCode, string> = {
  ...MEMORY_CODE_MESSAGES,
  NOT_FOUND: '연결할 대상을 찾을 수 없어요. 이미 지워졌을 수 있습니다.',
  CONFLICT:
    '연결하는 사이에 내용이 바뀌었어요. 기록과 사진은 그대로 있습니다. 최신 내용을 확인한 뒤 다시 연결해 주세요.',
  VALIDATION_ERROR: '연결 정보를 다시 확인해 주세요.',
  RETRYABLE_ERROR: '일시적인 문제로 연결하지 못했어요. 같은 화면에서 다시 시도해 주세요.',
  UNKNOWN: '연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
};

/**
 * 코드 + DETAIL 조합으로 더 정확한 문장을 고른다.
 *
 * 마이그레이션이 던지는 힌트와 1:1로 맞춘다. 힌트가 늘어나면 여기에 문장을 더한다.
 */
const DETAILED_MESSAGES: Record<string, string> = {
  // 원본이 아직 완료가 아니다. 무엇을 먼저 해야 하는지 알려 준다.
  'CONFLICT:eventId:not_done':
    '이 일정을 아직 완료로 표시하지 않았어요. 캘린더에서 완료 체크한 뒤 다시 연결해 주세요.',
  'CONFLICT:wishId:not_done':
    '이 위시를 아직 완료로 표시하지 않았어요. 위시 화면에서 완료로 바꾼 뒤 다시 연결해 주세요.',
  // 잠금 사이에 원본이 사라졌다. 재시도해도 결과가 같다.
  'CONFLICT:eventId:gone':
    '연결하려던 일정이 사라졌어요. 기록과 사진은 그대로 있습니다. 다른 계획을 고르거나 연결 없이 두세요.',
  'CONFLICT:wishId:gone':
    '연결하려던 위시가 사라졌어요. 기록과 사진은 그대로 있습니다. 다른 계획을 고르거나 연결 없이 두세요.',
  'CONFLICT:expectedVersion:stale':
    '상대방이 먼저 이 기록을 바꿨어요. 기록과 사진은 그대로 있습니다. 최신 내용을 불러온 뒤 다시 연결해 주세요.',
  'CONFLICT:requestId:payload_mismatch':
    '같은 요청 번호로 다른 연결을 보냈어요. 화면을 새로 불러온 뒤 다시 시도해 주세요.',
  'RETRYABLE_ERROR:requestId:in_progress':
    '같은 요청을 처리하는 중이에요. 잠시 후 같은 화면에서 다시 시도해 주세요.',
  'NOT_FOUND:eventId:missing':
    '연결할 일정을 찾을 수 없어요. 이미 지워졌거나 다른 공간의 일정입니다.',
  'NOT_FOUND:wishId:missing':
    '연결할 위시를 찾을 수 없어요. 이미 지워졌거나 다른 공간의 위시입니다.',
  'NOT_FOUND:memoryId:missing':
    '이 기록을 더 이상 찾을 수 없어요. 이미 지워졌을 수 있습니다.',
  'NOT_FOUND:memoryLink:missing':
    '이미 연결이 없어요. 최신 내용을 불러오면 화면이 맞춰집니다.',
  'VALIDATION_ERROR:source:allowed': '알 수 없는 연결 종류예요. 일정·위시 화면에서 다시 들어와 주세요.',
  'VALIDATION_ERROR:sourceId:required': '연결할 계획을 고르지 않았어요.',
};

export function mapLinkRpcError(error: PostgresErrorLike | null | undefined): MemoryActionFailure {
  const sqlstate = (error?.code ?? '').trim();
  // SQLSTATE가 비어 있으면 요청이 DB까지 가지 못했다(네트워크·시간 초과).
  // 이미 처리됐는지 알 수 없으므로 같은 requestId로 재시도할 수 있게 둔다.
  const code: MemoryErrorCode =
    sqlstate === '' ? 'RETRYABLE_ERROR' : (SQLSTATE_TO_CODE[sqlstate] ?? 'UNKNOWN');
  const { fieldErrors: hints } = parseErrorDetail(error?.details ?? null);

  let message = LINK_CODE_MESSAGES[code];
  for (const [key, reason] of Object.entries(hints)) {
    const detailed = DETAILED_MESSAGES[`${code}:${key}:${reason}`];
    if (detailed) {
      message = detailed;
      break;
    }
  }

  return { ok: false, code, message };
}

export function linkFailure(code: MemoryErrorCode, message?: string): MemoryActionFailure {
  return { ok: false, code, message: message ?? LINK_CODE_MESSAGES[code] };
}

/** 서버 로그. 작업 이름·오류 코드·요청 ID만 남긴다(DESIGN.md 11). */
export function logLinkFailure(operation: string, code: MemoryErrorCode, requestId?: string): void {
  const parts = [`memoryLinks.${operation}`, `code=${code}`];
  if (requestId) parts.push(`requestId=${requestId}`);
  console.error(parts.join(' '));
}
