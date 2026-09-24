/**
 * DB RPC·Auth 오류를 화면에 보여 줄 수 있는 결과로 바꾼다.
 *
 * 기준: docs/database/CONTRACTS.md 0절 "오류 매핑", DESIGN.md 7절.
 *   - 분기는 예외의 SQLSTATE(`code`)로 한다. 메시지 문자열을 파싱하지 않는다.
 *   - `DETAIL`에는 필드 힌트 JSON만 들어 있다. 사용자 본문·이메일·토큰은 들어 있지 않다.
 *   - `path` 같은 진단용 예약 키는 입력 필드가 아니므로 `fieldErrors`로 옮기지 않는다.
 *   - 조회 권한 오류(42501)는 존재 여부를 알리지 않도록 NOT_FOUND로 통일한다.
 */

export const AUTH_ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INVITE_INVALID',
  'SPACE_FULL',
  'VALIDATION_ERROR',
  'RETRYABLE_ERROR',
  /** 인증 메일 링크가 만료·재사용된 경우. DESIGN 7절 목록 밖의 인증 전용 코드다. */
  'LINK_INVALID',
  /** Supabase 설정이 없거나 잘못된 경우. 인증 성공으로 대체하지 않는다. */
  'CONFIG_ERROR',
  'UNKNOWN',
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export type FieldErrors = Record<string, string>;

export type ActionFailure = {
  ok: false;
  code: AuthErrorCode;
  message: string;
  /** 폼 필드에 그대로 붙일 수 있는 오류만 담는다. */
  fieldErrors?: FieldErrors;
  /** 필드가 아닌 진단 힌트(`path` 등). 화면에는 쓰지 않고 보고·로그 판단에만 쓴다. */
  diagnostics?: Record<string, string>;
};

export type ActionSuccess<T> = { ok: true; data: T };
export type ActionResult<T = null> = ActionSuccess<T> | ActionFailure;

/** `DETAIL` JSON에서 입력 필드가 아닌 예약 키. CONTRACTS.md 0절. */
export const DIAGNOSTIC_DETAIL_KEYS = new Set(['path']);

const SQLSTATE_TO_CODE: Record<string, AuthErrorCode> = {
  GF401: 'UNAUTHENTICATED',
  GF403: 'FORBIDDEN',
  GF404: 'NOT_FOUND',
  GF409: 'CONFLICT',
  GF410: 'INVITE_INVALID',
  GF411: 'SPACE_FULL',
  GF412: 'UNKNOWN', // 업로드 확정. 이번 범위에서는 호출하지 않는다.
  GF422: 'VALIDATION_ERROR',
  GF503: 'RETRYABLE_ERROR',
  // 권한 없는 직접 접근. 상세를 노출하지 않는다.
  '42501': 'NOT_FOUND',
  // 계약에 없는 제약 위반. 코드만 남기고 충돌로 다룬다.
  '23505': 'CONFLICT',
  // 외래 키 위반(CAL-001). 연결된 자식 행이 있어 **확정적으로 거부**된 요청이다.
  // UNKNOWN으로 두면 화면이 "같은 내용으로 다시 시도하면 된다"고 잘못 안내해 무한 재시도가 된다.
  // 앱 경로에서는 RPC가 먼저 GF404/GF409로 막으므로 이 매핑은 마지막 방어선이다.
  '23503': 'CONFLICT',
  // PostgREST: JWT 문제
  PGRST301: 'UNAUTHENTICATED',
  PGRST302: 'UNAUTHENTICATED',
};

export type DetailParts = {
  fieldErrors: FieldErrors;
  diagnostics: Record<string, string>;
};

/** `DETAIL` 문자열(또는 이미 파싱된 객체)을 필드 힌트와 진단 힌트로 나눈다. */
export function parseErrorDetail(detail: unknown): DetailParts {
  const parts: DetailParts = { fieldErrors: {}, diagnostics: {} };

  let raw: unknown = detail;
  if (typeof detail === 'string') {
    const trimmed = detail.trim();
    if (trimmed.length === 0) return parts;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      // 형식이 다르면 진단으로도 남기지 않는다. 사용자 입력이 섞일 수 있다.
      return parts;
    }
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return parts;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    if (DIAGNOSTIC_DETAIL_KEYS.has(key)) {
      parts.diagnostics[key] = value;
    } else {
      parts.fieldErrors[key] = value;
    }
  }

  return parts;
}

/** 폼 필드에 표시할 수 있는 이름. 그 밖의 키는 상단 요약으로만 보여 준다. */
const FORM_FIELDS = new Set([
  'name',
  'introduction',
  'relationshipStartDate',
  'nickname',
  'targetEmail',
  'email',
  'password',
]);

const FIELD_LABELS: Record<string, string> = {
  name: '공간 이름',
  introduction: '한 줄 소개',
  relationshipStartDate: '함께한 날짜',
  nickname: '닉네임',
  targetEmail: '상대방 이메일',
  email: '이메일',
  password: '비밀번호',
};

const FIELD_REASON_MESSAGES: Record<string, string> = {
  'name:length': '공간 이름은 1~30자로 입력해 주세요.',
  'introduction:length': '한 줄 소개는 200자까지 쓸 수 있어요.',
  'relationshipStartDate:future_date': '함께한 날짜는 오늘보다 뒤일 수 없어요.',
  'nickname:length': '닉네임은 1~20자로 입력해 주세요.',
  'targetEmail:format': '이메일 형식을 확인해 주세요.',
  'targetEmail:self': '자기 자신에게는 초대를 보낼 수 없어요.',
  'targetEmail:already_member': '이미 이 공간에 참여한 계정이에요.',
  'email:format': '이메일 형식을 확인해 주세요.',
  'email:unverified': '이메일 확인이 끝나지 않은 계정이에요.',
  'password:length': '비밀번호 길이를 확인해 주세요.',
};

function fieldMessage(field: string, reason: string): string {
  const exact = FIELD_REASON_MESSAGES[`${field}:${reason}`];
  if (exact) return exact;
  const label = FIELD_LABELS[field] ?? '입력';
  if (reason === 'length') return `${label} 길이를 확인해 주세요.`;
  if (reason === 'format') return `${label} 형식을 확인해 주세요.`;
  if (reason === 'required') return `${label}을(를) 입력해 주세요.`;
  return `${label}을(를) 다시 확인해 주세요.`;
}

const CODE_MESSAGES: Record<AuthErrorCode, string> = {
  UNAUTHENTICATED: '로그인이 필요합니다. 다시 로그인한 뒤 시도해 주세요.',
  FORBIDDEN: '이 작업을 할 권한이 없습니다.',
  NOT_FOUND: '대상을 찾을 수 없거나 접근할 수 없습니다.',
  CONFLICT: '먼저 저장된 변경이 있어 처리하지 못했습니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.',
  INVITE_INVALID:
    '사용할 수 없는 초대 링크입니다. 이미 사용했거나 폐기됐거나 다른 계정을 대상으로 만든 링크일 수 있어요. 상대방에게 새 초대 링크를 요청해 주세요.',
  SPACE_FULL: '이 공간은 이미 두 사람이 모두 참여해 정원이 찼습니다.',
  VALIDATION_ERROR: '입력을 다시 확인해 주세요.',
  RETRYABLE_ERROR: '일시적인 문제로 처리하지 못했습니다. 잠시 후 같은 화면에서 다시 시도해 주세요.',
  LINK_INVALID: '링크가 만료됐거나 이미 사용됐습니다. 새 링크를 요청해 주세요.',
  CONFIG_ERROR:
    '서버에 Supabase 설정이 없어 인증을 사용할 수 없습니다. 운영자가 환경 변수를 설정해야 합니다.',
  UNKNOWN: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
};

/** 코드 + DETAIL 조합에서 더 정확한 문장을 고른다. */
const DETAILED_MESSAGES: Record<string, string> = {
  'FORBIDDEN:email:unverified':
    '이메일 확인이 끝나지 않은 계정입니다. 받은 편지함의 확인 링크를 먼저 열어 주세요.',
  'FORBIDDEN:space:bootstrap_not_allowed':
    '이 계정에는 첫 공간을 만들 권한이 없습니다. 운영자가 허용한 계정만 공간을 만들 수 있어요. 초대를 받았다면 초대 링크로 들어와 주세요.',
  'CONFLICT:space:already_member': '이미 공간에 참여해 있습니다.',
  'CONFLICT:space:already_member_of_other_space':
    '이미 다른 공간에 참여한 계정입니다. 한 계정은 공간 하나에만 참여할 수 있어요.',
  'CONFLICT:inviteId:already_accepted': '이미 수락된 초대라 폐기할 수 없습니다.',
  'CONFLICT:expectedVersion:stale':
    '상대방이 먼저 저장한 내용이 있습니다. 화면을 새로 불러온 뒤 다시 저장해 주세요.',
  'CONFLICT:requestId:payload_mismatch':
    '같은 요청 번호로 다른 내용을 보냈습니다. 화면을 새로 불러온 뒤 다시 저장해 주세요.',
  'CONFLICT:wishId:has_calendar_events':
    '이 위시로 만든 캘린더 일정이 있어 지울 수 없습니다. 캘린더에서 연결된 일정을 먼저 지우거나 연결을 해제한 뒤 다시 시도해 주세요.',
  'INVITE_INVALID:token:expired':
    '초대 링크가 만료됐습니다. 상대방에게 새 초대 링크를 만들어 달라고 요청해 주세요.',
  'INVITE_INVALID:email:unverified':
    '이메일 확인이 끝난 계정만 초대를 수락할 수 있습니다. 받은 편지함의 확인 링크를 먼저 열어 주세요.',
  'SPACE_FULL:space:member_limit': '이 공간은 이미 두 사람이 모두 참여해 정원이 찼습니다.',
  'RETRYABLE_ERROR:requestId:in_progress':
    '같은 요청을 처리하는 중입니다. 잠시 후 같은 화면에서 다시 시도해 주세요.',
  'RETRYABLE_ERROR:requestId:lost':
    '요청 결과를 확인하지 못했습니다. 잠시 후 같은 화면에서 다시 시도해 주세요.',
  'NOT_FOUND:space:not_member':
    '아직 어떤 공간에도 참여하지 않았습니다. 공간을 만들거나 초대 링크로 참여해 주세요.',
};

function pickMessage(code: AuthErrorCode, fieldErrors: FieldErrors): string {
  for (const [field, reason] of Object.entries(fieldErrors)) {
    const detailed = DETAILED_MESSAGES[`${code}:${field}:${reason}`];
    if (detailed) return detailed;
  }
  if (code === 'VALIDATION_ERROR') {
    const first = Object.entries(fieldErrors)[0];
    if (first) return fieldMessage(first[0], first[1]);
  }
  return CODE_MESSAGES[code];
}

export type PostgresErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

/** DB RPC 오류(PostgREST 응답)를 화면 결과로 바꾼다. */
export function mapPostgrestError(error: PostgresErrorLike | null | undefined): ActionFailure {
  const sqlstate = (error?.code ?? '').trim();
  const code = SQLSTATE_TO_CODE[sqlstate] ?? 'UNKNOWN';
  const { fieldErrors, diagnostics } = parseErrorDetail(error?.details ?? null);

  const failure: ActionFailure = {
    ok: false,
    code,
    message: pickMessage(code, fieldErrors),
  };

  // 필드 오류는 입력 검증 실패에만 붙인다. 다른 코드의 DETAIL은 폼 필드가 아니다.
  if (code === 'VALIDATION_ERROR') {
    const formErrors: FieldErrors = {};
    for (const [field, reason] of Object.entries(fieldErrors)) {
      if (FORM_FIELDS.has(field)) formErrors[field] = fieldMessage(field, reason);
    }
    if (Object.keys(formErrors).length > 0) failure.fieldErrors = formErrors;
  }

  if (Object.keys(diagnostics).length > 0) failure.diagnostics = diagnostics;
  return failure;
}

export type AuthErrorLike = {
  code?: string | null;
  status?: number | null;
  message?: string | null;
  name?: string | null;
};

const AUTH_CODE_MAP: Record<string, { code: AuthErrorCode; message: string }> = {
  invalid_credentials: {
    code: 'UNAUTHENTICATED',
    // 계정 존재 여부를 알려 주지 않는다.
    message: '이메일 또는 비밀번호가 올바르지 않습니다.',
  },
  invalid_grant: {
    code: 'UNAUTHENTICATED',
    message: '이메일 또는 비밀번호가 올바르지 않습니다.',
  },
  email_not_confirmed: {
    code: 'FORBIDDEN',
    message: '이메일 확인이 끝나지 않은 계정입니다. 받은 편지함의 확인 링크를 먼저 열어 주세요.',
  },
  user_banned: {
    code: 'FORBIDDEN',
    message: '사용이 정지된 계정입니다. 운영자에게 문의해 주세요.',
  },
  over_request_rate_limit: {
    code: 'RETRYABLE_ERROR',
    message: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
  },
  over_email_send_rate_limit: {
    code: 'RETRYABLE_ERROR',
    message: '메일 발송 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
  },
  otp_expired: {
    code: 'LINK_INVALID',
    message: '링크가 만료됐거나 이미 사용됐습니다. 새 링크를 요청해 주세요.',
  },
  flow_state_expired: {
    code: 'LINK_INVALID',
    message: '인증 절차가 만료됐습니다. 처음부터 다시 시도해 주세요.',
  },
  flow_state_not_found: {
    code: 'LINK_INVALID',
    message: '인증 절차를 찾을 수 없습니다. 링크를 요청한 브라우저에서 다시 시도해 주세요.',
  },
  bad_code_verifier: {
    code: 'LINK_INVALID',
    message: '인증 절차를 확인하지 못했습니다. 링크를 요청한 브라우저에서 다시 열어 주세요.',
  },
  session_not_found: {
    code: 'UNAUTHENTICATED',
    message: '세션이 만료됐습니다. 다시 로그인해 주세요.',
  },
  weak_password: {
    code: 'VALIDATION_ERROR',
    message: '비밀번호가 너무 단순합니다. 더 길고 다양한 문자로 만들어 주세요.',
  },
  same_password: {
    code: 'VALIDATION_ERROR',
    message: '이전과 다른 비밀번호를 입력해 주세요.',
  },
  signup_disabled: {
    code: 'FORBIDDEN',
    message: '이 서비스는 공개 가입을 받지 않습니다. 운영자에게 계정을 요청해 주세요.',
  },
  email_address_not_authorized: {
    code: 'FORBIDDEN',
    message: '이 주소로는 메일을 보낼 수 없습니다. 운영자에게 문의해 주세요.',
  },
};

/** Supabase Auth 오류를 화면 결과로 바꾼다. 메시지 원문을 그대로 노출하지 않는다. */
export function mapAuthError(error: AuthErrorLike | null | undefined): ActionFailure {
  const code = (error?.code ?? '').trim();
  const mapped = AUTH_CODE_MAP[code];
  if (mapped) {
    const failure: ActionFailure = { ok: false, code: mapped.code, message: mapped.message };
    if (mapped.code === 'VALIDATION_ERROR' && (code === 'weak_password' || code === 'same_password')) {
      failure.fieldErrors = { password: mapped.message };
    }
    return failure;
  }

  const status = error?.status ?? 0;
  if (status === 401 || status === 403) {
    return { ok: false, code: 'UNAUTHENTICATED', message: CODE_MESSAGES.UNAUTHENTICATED };
  }
  if (status === 429) {
    return {
      ok: false,
      code: 'RETRYABLE_ERROR',
      message: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
    };
  }
  if (status >= 500 || status === 0) {
    return { ok: false, code: 'RETRYABLE_ERROR', message: CODE_MESSAGES.RETRYABLE_ERROR };
  }
  return { ok: false, code: 'UNKNOWN', message: CODE_MESSAGES.UNKNOWN };
}

export function failure(code: AuthErrorCode, message?: string, fieldErrors?: FieldErrors): ActionFailure {
  const result: ActionFailure = { ok: false, code, message: message ?? CODE_MESSAGES[code] };
  if (fieldErrors && Object.keys(fieldErrors).length > 0) result.fieldErrors = fieldErrors;
  return result;
}

export function messageForCode(code: AuthErrorCode): string {
  return CODE_MESSAGES[code];
}

/**
 * 실패를 서버 로그에 남긴다.
 * 작업 이름·오류 코드·요청 상관관계 ID만 남긴다(DESIGN.md 11).
 * 사용자 입력·이메일·토큰은 어떤 경우에도 넣지 않는다.
 */
export function logFailure(operation: string, result: ActionFailure, requestId?: string): void {
  const parts = [`auth.${operation}`, `code=${result.code}`];
  if (requestId) parts.push(`requestId=${requestId}`);
  if (result.diagnostics?.path) parts.push(`path=${result.diagnostics.path}`);
  console.error(parts.join(' '));
}
