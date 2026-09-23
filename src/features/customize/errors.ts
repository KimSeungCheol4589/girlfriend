import { parseErrorDetail, type PostgresErrorLike } from '@/features/auth/errors';
import type { MemoryActionResult, MemoryErrorCode } from '@/features/memories/live/errors';

/**
 * 꾸미기 서버 작업의 결과·오류 계약.
 *
 * DESIGN.md 7: 성공 `{ ok: true, data }`, 실패 `{ ok: false, code, message }`.
 * CONTRACTS.md 0: 분기는 SQLSTATE로만 한다. 메시지 문자열을 파싱하지 않는다.
 * 문장은 꾸미기 화면 기준으로 쓴다(추억 문구를 그대로 쓰면 무엇이 저장되지 않았는지 오해하게 된다).
 */

export const CUSTOMIZE_ERROR_CODES = [
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFLICT',
  'UPLOAD_FAILED',
  'RETRYABLE_ERROR',
  /** 서버에 사진 확정 자격 증명이 없다. 커버 업로드만 막히고 나머지 저장은 그대로 된다. */
  'PHOTOS_DISABLED',
  'CONFIG_ERROR',
  'UNKNOWN',
] as const;

export type CustomizeErrorCode = (typeof CUSTOMIZE_ERROR_CODES)[number];

export type CustomizeFailure = {
  ok: false;
  code: CustomizeErrorCode;
  message: string;
  /** 커버 확정에서 객체가 아직 없을 때: 같은 pending asset·같은 경로로 다시 올린다. */
  retryStage?: 'upload';
};

export type CustomizeResult<T> = { ok: true; data: T } | CustomizeFailure;

const SQLSTATE_TO_CODE: Record<string, CustomizeErrorCode> = {
  GF401: 'UNAUTHENTICATED',
  // 꾸미기에서 FORBIDDEN이 나오면 설정 문제다. 사용자에게 권한 구조를 설명하지 않는다.
  GF403: 'UNKNOWN',
  GF404: 'NOT_FOUND',
  GF409: 'CONFLICT',
  GF412: 'UPLOAD_FAILED',
  GF422: 'VALIDATION_ERROR',
  GF503: 'RETRYABLE_ERROR',
  '42501': 'NOT_FOUND',
  '23505': 'CONFLICT',
  PGRST301: 'UNAUTHENTICATED',
  PGRST302: 'UNAUTHENTICATED',
};

export const CUSTOMIZE_CODE_MESSAGES: Record<CustomizeErrorCode, string> = {
  UNAUTHENTICATED:
    '로그인이 끝났습니다. 다시 로그인한 뒤 저장해 주세요. 고른 설정은 이 화면에 그대로 있어요.',
  NOT_FOUND:
    '이 공간의 설정을 찾을 수 없거나 접근할 수 없습니다. 화면을 다시 불러온 뒤 시도해 주세요.',
  VALIDATION_ERROR: '설정 값을 다시 확인해 주세요.',
  CONFLICT:
    '상대방이 먼저 꾸미기 설정을 저장했습니다. 고른 값은 그대로 두었어요. 최신 설정을 불러온 뒤 다시 저장해 주세요.',
  UPLOAD_FAILED: '커버 사진을 확인하지 못했습니다. 다른 사진을 골라 주세요.',
  RETRYABLE_ERROR: '일시적인 문제로 저장하지 못했습니다. 같은 화면에서 다시 저장해 주세요.',
  // 무엇이 막히고(새 커버 업로드) 무엇이 되는지(나머지 저장·기존 커버)를 둘 다 말한다.
  PHOTOS_DISABLED:
    '서버에 사진 확인 설정이 없어 지금은 새 커버를 올릴 수 없습니다. 테마·포인트 색상·홈 섹션 저장과 기존 커버 유지는 그대로 됩니다.',
  CONFIG_ERROR: '서버 설정이 없어 저장할 수 없습니다. 운영자가 환경 변수를 설정해야 합니다.',
  UNKNOWN: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
};

/** 코드 + DETAIL 조합으로 더 정확한 문장을 고른다. */
const DETAILED_MESSAGES: Record<string, string> = {
  'CONFLICT:expectedVersion:stale': CUSTOMIZE_CODE_MESSAGES.CONFLICT,
  'CONFLICT:requestId:payload_mismatch':
    '같은 요청 번호로 다른 설정을 보냈습니다. 고른 값은 그대로 두었어요. 다시 저장해 주세요.',
  'RETRYABLE_ERROR:requestId:in_progress':
    '같은 저장을 처리하는 중입니다. 잠시 후 같은 화면에서 다시 시도해 주세요.',
  'NOT_FOUND:coverAssetId:missing':
    '고른 커버 사진을 찾을 수 없습니다. 상대방이 올린 사진은 그대로 둘 수만 있고 새로 지정할 수는 없어요.',
  'VALIDATION_ERROR:themeKey:invalid': '테마는 크림·로즈·세이지 중에서 고를 수 있어요.',
  'VALIDATION_ERROR:accentColor:format': '포인트 색상은 #RRGGBB 형식으로 입력해 주세요.',
  'VALIDATION_ERROR:homeSections:invalid': '홈 섹션은 세 가지가 한 번씩만 들어가야 해요.',
  'VALIDATION_ERROR:coverAssetId:purpose':
    '이 파일은 커버로 쓸 수 없어요. 커버 사진을 다시 골라 주세요.',
  'VALIDATION_ERROR:coverAssetId:not_ready':
    '고른 커버 사진을 더 쓸 수 없어요(확인이 끝나지 않았거나 정리된 파일입니다). 커버 사진을 다시 골라 주세요.',
};

export function customizeFailure(code: CustomizeErrorCode, message?: string): CustomizeFailure {
  return { ok: false, code, message: message ?? CUSTOMIZE_CODE_MESSAGES[code] };
}

/**
 * PostgREST 오류를 꾸미기 결과로 바꾼다.
 *
 * SQLSTATE가 비어 있으면 요청이 DB까지 가지 못한 경우다(네트워크·시간 초과).
 * 이미 처리됐는지 알 수 없으므로 RETRYABLE_ERROR로 두고, 호출자는 같은 requestId를 유지한다.
 */
export function mapCustomizeRpcError(error: PostgresErrorLike | null | undefined): CustomizeFailure {
  const sqlstate = (error?.code ?? '').trim();
  const code: CustomizeErrorCode =
    sqlstate === '' ? 'RETRYABLE_ERROR' : (SQLSTATE_TO_CODE[sqlstate] ?? 'UNKNOWN');
  const { fieldErrors } = parseErrorDetail(error?.details ?? null);

  let message = CUSTOMIZE_CODE_MESSAGES[code];
  for (const [key, reason] of Object.entries(fieldErrors)) {
    const detailed = DETAILED_MESSAGES[`${code}:${key}:${reason}`];
    if (detailed) {
      message = detailed;
      break;
    }
  }

  return { ok: false, code, message };
}

/**
 * 공용 사진 파이프라인(추억 모듈)의 결과를 꾸미기 결과로 옮긴다.
 *
 * 사진 자체를 설명하는 문장(형식·용량·디코딩 거부)은 그대로 쓰는 것이 정확하다.
 * 그 밖의 코드는 "무엇이 저장되지 않았는지"가 달라지므로 꾸미기 문장으로 바꾼다.
 */
export function fromPhotoResult<T>(result: MemoryActionResult<T>): CustomizeResult<T> {
  if (result.ok) return result;

  const code = toCustomizeCode(result.code);
  const keepMessage = code === 'UPLOAD_FAILED' || code === 'VALIDATION_ERROR';
  const failure: CustomizeFailure = {
    ok: false,
    code,
    message: keepMessage ? result.message : CUSTOMIZE_CODE_MESSAGES[code],
  };
  if (result.retryStage === 'upload') failure.retryStage = 'upload';
  return failure;
}

function toCustomizeCode(code: MemoryErrorCode): CustomizeErrorCode {
  return (CUSTOMIZE_ERROR_CODES as readonly string[]).includes(code)
    ? (code as CustomizeErrorCode)
    : 'UNKNOWN';
}

/**
 * 응답이 확정적인지. 확정 응답을 받으면 다음 시도는 새 requestId를 쓴다.
 * 재시도 가능·원인 불명은 서버가 처리했는지 알 수 없으므로 같은 키를 유지한다.
 */
export function isDefinitiveCustomizeResult(result: CustomizeResult<unknown>): boolean {
  if (result.ok) return true;
  return result.code !== 'RETRYABLE_ERROR' && result.code !== 'UNKNOWN';
}

/**
 * 서버 로그. 작업 이름·오류 코드·요청 ID만 남긴다(DESIGN.md 11).
 * 색상·파일 경로·이메일은 넣지 않는다.
 */
export function logCustomizeFailure(operation: string, code: CustomizeErrorCode, requestId?: string): void {
  const parts = [`customize.${operation}`, `code=${code}`];
  if (requestId) parts.push(`requestId=${requestId}`);
  console.error(parts.join(' '));
}
