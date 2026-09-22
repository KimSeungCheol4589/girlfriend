import { parseErrorDetail, type PostgresErrorLike } from '@/features/auth/errors';

/**
 * 추억 서버 작업의 결과·오류 계약.
 *
 * DESIGN.md 7: 성공 `{ ok: true, data }`, 실패 `{ ok: false, code, message, fieldErrors? }`.
 * CONTRACTS.md 0: 분기는 SQLSTATE로만 한다. 메시지 문자열을 파싱하지 않는다.
 * DETAIL의 필드 힌트는 폼 필드 이름으로 옮기고, 사용자 본문은 어떤 로그에도 넣지 않는다.
 */

export const MEMORY_ERROR_CODES = [
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFLICT',
  'UPLOAD_FAILED',
  'RETRYABLE_ERROR',
  /** 서버에 사진 확정 자격 증명이 없다. 글 저장은 계속 가능하다. */
  'PHOTOS_DISABLED',
  'CONFIG_ERROR',
  'UNKNOWN',
] as const;

export type MemoryErrorCode = (typeof MEMORY_ERROR_CODES)[number];

/** 폼에 표시하는 필드. `photos`는 사진 영역 전체를 가리킨다. */
export type MemoryFormField = 'title' | 'memoryDate' | 'location' | 'tags' | 'body' | 'photos';

export type MemoryFieldErrors = Partial<Record<MemoryFormField, string>>;

export type MemoryActionFailure = {
  ok: false;
  code: MemoryErrorCode;
  message: string;
  fieldErrors?: MemoryFieldErrors;
  /** 사진 확정에서 객체가 아직 없을 때: 같은 pending asset·같은 경로로 다시 올린다. */
  retryStage?: 'upload';
};

export type MemoryActionResult<T> = { ok: true; data: T } | MemoryActionFailure;

const SQLSTATE_TO_CODE: Record<string, MemoryErrorCode> = {
  GF401: 'UNAUTHENTICATED',
  // 추억 작업에서 FORBIDDEN이 나오면 설정 문제다. 사용자에게 권한 구조를 설명하지 않는다.
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

export const MEMORY_CODE_MESSAGES: Record<MemoryErrorCode, string> = {
  UNAUTHENTICATED: '로그인이 끝났습니다. 다시 로그인한 뒤 시도해 주세요. 쓰던 내용은 이 화면에 남아 있어요.',
  NOT_FOUND: '기록을 찾을 수 없거나 접근할 수 없습니다. 이미 지워졌을 수 있어요.',
  VALIDATION_ERROR: '입력을 다시 확인해 주세요.',
  CONFLICT:
    '상대방이 먼저 이 기록을 바꿨습니다. 쓰던 내용은 그대로 두었어요. 최신 내용을 확인한 뒤 다시 저장해 주세요.',
  UPLOAD_FAILED: '사진을 확인하지 못했습니다. 다른 사진을 골라 주세요.',
  RETRYABLE_ERROR: '일시적인 문제로 처리하지 못했습니다. 같은 화면에서 다시 시도해 주세요.',
  PHOTOS_DISABLED:
    '서버에 사진 확인 설정이 없어 지금은 사진을 올릴 수 없습니다. 글은 사진 없이 저장할 수 있어요.',
  CONFIG_ERROR: '서버 설정이 없어 저장할 수 없습니다. 운영자가 환경 변수를 설정해야 합니다.',
  UNKNOWN: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
};

/** DB DETAIL의 키 → 폼 필드. 목록 밖의 키는 필드 오류로 옮기지 않는다. */
const DETAIL_FIELD_MAP: Record<string, MemoryFormField> = {
  title: 'title',
  body: 'body',
  memoryDate: 'memoryDate',
  location: 'location',
  tags: 'tags',
  photoAssetIds: 'photos',
};

const FIELD_REASON_MESSAGES: Record<string, string> = {
  'title:length': '제목은 1~80자로 입력해 주세요.',
  'body:length': '본문은 10,000자까지 쓸 수 있어요.',
  'location:length': '장소는 100자까지 입력할 수 있어요.',
  'memoryDate:required': '날짜를 선택해 주세요.',
  'memoryDate:future_date': '오늘(한국 날짜)보다 뒤의 날짜는 저장할 수 없어요.',
  'tags:invalid': '태그는 최대 5개, 하나당 1~20자이며 같은 태그를 두 번 쓸 수 없어요.',
  'photoAssetIds:limit': '사진은 최대 10장까지 붙일 수 있어요.',
  'photoAssetIds:duplicate': '같은 사진이 두 번 들어 있어요.',
  'photoAssetIds:not_ready': '아직 확인이 끝나지 않은 사진이 있어요. 업로드가 끝난 뒤 저장해 주세요.',
  'photoAssetIds:purpose': '이 기록에 붙일 수 없는 파일이 있어요.',
  'photoAssetIds:missing': '사진 일부를 찾을 수 없어요. 해당 사진을 빼고 다시 올려 주세요.',
  'photoAssetIds:already_attached': '다른 기록에 이미 붙은 사진이 있어요. 해당 사진을 빼고 저장해 주세요.',
};

function reasonMessage(key: string, reason: string): string {
  return FIELD_REASON_MESSAGES[`${key}:${reason}`] ?? MEMORY_CODE_MESSAGES.VALIDATION_ERROR;
}

/** 코드 + DETAIL 조합으로 더 정확한 상단 문장을 고른다. */
const DETAILED_MESSAGES: Record<string, string> = {
  'CONFLICT:requestId:payload_mismatch':
    '같은 요청 번호로 다른 내용을 보냈습니다. 쓰던 내용은 그대로 두었어요. 다시 저장해 주세요.',
  'CONFLICT:photoAssetIds:already_attached': FIELD_REASON_MESSAGES['photoAssetIds:already_attached'] ?? '',
  'CONFLICT:assetId:attached': '이미 기록에 붙은 사진이라 취소할 수 없어요.',
  'NOT_FOUND:photoAssetIds:missing': FIELD_REASON_MESSAGES['photoAssetIds:missing'] ?? '',
  'RETRYABLE_ERROR:requestId:in_progress':
    '같은 요청을 처리하는 중입니다. 잠시 후 같은 화면에서 다시 시도해 주세요.',
  'UPLOAD_FAILED:assetId:expired': '업로드한 지 오래된 사진입니다. 사진을 다시 골라 주세요.',
  'UPLOAD_FAILED:assetId:deleting': '정리 중인 사진입니다. 사진을 다시 골라 주세요.',
};

/**
 * PostgREST 오류를 추억 결과로 바꾼다.
 *
 * SQLSTATE가 비어 있으면 요청이 DB까지 가지 못한 경우다(네트워크·시간 초과).
 * 이미 처리됐는지 알 수 없으므로 RETRYABLE_ERROR로 두고, 호출자는 같은 requestId를 유지한다.
 */
export function mapMemoryRpcError(error: PostgresErrorLike | null | undefined): MemoryActionFailure {
  const sqlstate = (error?.code ?? '').trim();
  const code: MemoryErrorCode =
    sqlstate === '' ? 'RETRYABLE_ERROR' : (SQLSTATE_TO_CODE[sqlstate] ?? 'UNKNOWN');
  const { fieldErrors: hints } = parseErrorDetail(error?.details ?? null);

  let message = MEMORY_CODE_MESSAGES[code];
  for (const [key, reason] of Object.entries(hints)) {
    const detailed = DETAILED_MESSAGES[`${code}:${key}:${reason}`];
    if (detailed) {
      message = detailed;
      break;
    }
  }

  const failure: MemoryActionFailure = { ok: false, code, message };

  if (code === 'VALIDATION_ERROR' || (code === 'NOT_FOUND' && 'photoAssetIds' in hints)) {
    const fieldErrors: MemoryFieldErrors = {};
    for (const [key, reason] of Object.entries(hints)) {
      const field = DETAIL_FIELD_MAP[key];
      if (field && fieldErrors[field] === undefined) fieldErrors[field] = reasonMessage(key, reason);
    }
    if (Object.keys(fieldErrors).length > 0) {
      failure.fieldErrors = fieldErrors;
      if (code === 'VALIDATION_ERROR') {
        const first = Object.values(fieldErrors)[0];
        if (first) failure.message = first;
      }
    }
  }

  return failure;
}

export function memoryFailure(
  code: MemoryErrorCode,
  message?: string,
  fieldErrors?: MemoryFieldErrors,
): MemoryActionFailure {
  const result: MemoryActionFailure = { ok: false, code, message: message ?? MEMORY_CODE_MESSAGES[code] };
  if (fieldErrors && Object.keys(fieldErrors).length > 0) result.fieldErrors = fieldErrors;
  return result;
}

/**
 * 응답이 확정적인지. 확정 응답을 받으면 다음 시도는 새 requestId를 쓴다.
 * 재시도 가능·원인 불명은 서버가 처리했는지 알 수 없으므로 같은 키를 유지한다.
 */
export function isDefinitiveMemoryResult(result: MemoryActionResult<unknown>): boolean {
  if (result.ok) return true;
  return result.code !== 'RETRYABLE_ERROR' && result.code !== 'UNKNOWN';
}

/**
 * 서버 로그. 작업 이름·오류 코드·요청 ID만 남긴다(DESIGN.md 11).
 * 제목·본문·태그·파일 경로·이메일은 넣지 않는다.
 */
export function logMemoryFailure(operation: string, code: MemoryErrorCode, requestId?: string): void {
  const parts = [`memories.${operation}`, `code=${code}`];
  if (requestId) parts.push(`requestId=${requestId}`);
  console.error(parts.join(' '));
}
