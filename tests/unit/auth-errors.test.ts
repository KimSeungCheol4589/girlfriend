import { describe, expect, it } from 'vitest';

import { mapAuthError, mapPostgrestError, parseErrorDetail } from '@/features/auth/errors';

describe('parseErrorDetail', () => {
  it('필드 힌트와 진단 힌트를 나눈다', () => {
    const parts = parseErrorDetail('{"name":"length","path":"unique_violation"}');
    expect(parts.fieldErrors).toEqual({ name: 'length' });
    // path는 입력 필드가 아니라 진단용 예약 키다(CONTRACTS.md 0).
    expect(parts.diagnostics).toEqual({ path: 'unique_violation' });
  });

  it('형식이 아닌 DETAIL은 무시한다', () => {
    expect(parseErrorDetail('not json')).toEqual({ fieldErrors: {}, diagnostics: {} });
    expect(parseErrorDetail(null)).toEqual({ fieldErrors: {}, diagnostics: {} });
    expect(parseErrorDetail('[1,2]')).toEqual({ fieldErrors: {}, diagnostics: {} });
    expect(parseErrorDetail('')).toEqual({ fieldErrors: {}, diagnostics: {} });
  });
});

describe('mapPostgrestError', () => {
  it('GF 코드를 계약 코드로 바꾼다', () => {
    expect(mapPostgrestError({ code: 'GF401' }).code).toBe('UNAUTHENTICATED');
    expect(mapPostgrestError({ code: 'GF403' }).code).toBe('FORBIDDEN');
    expect(mapPostgrestError({ code: 'GF404' }).code).toBe('NOT_FOUND');
    expect(mapPostgrestError({ code: 'GF409' }).code).toBe('CONFLICT');
    expect(mapPostgrestError({ code: 'GF410' }).code).toBe('INVITE_INVALID');
    expect(mapPostgrestError({ code: 'GF411' }).code).toBe('SPACE_FULL');
    expect(mapPostgrestError({ code: 'GF422' }).code).toBe('VALIDATION_ERROR');
    expect(mapPostgrestError({ code: 'GF503' }).code).toBe('RETRYABLE_ERROR');
  });

  it('권한 오류는 존재 여부를 알리지 않도록 NOT_FOUND로 통일한다', () => {
    const result = mapPostgrestError({ code: '42501', message: 'permission denied for table x' });
    expect(result.code).toBe('NOT_FOUND');
    expect(result.message).not.toContain('permission');
  });

  it('예상 밖 제약 위반은 충돌로 다룬다', () => {
    expect(mapPostgrestError({ code: '23505' }).code).toBe('CONFLICT');
  });

  it('입력 검증 실패만 fieldErrors를 만든다', () => {
    const invalid = mapPostgrestError({ code: 'GF422', details: '{"name":"length"}' });
    expect(invalid.code).toBe('VALIDATION_ERROR');
    expect(invalid.fieldErrors).toEqual({ name: '공간 이름은 1~30자로 입력해 주세요.' });

    const conflict = mapPostgrestError({ code: 'GF409', details: '{"expectedVersion":"stale"}' });
    expect(conflict.fieldErrors).toBeUndefined();
    expect(conflict.message).toContain('다시 저장');
  });

  it('진단 예약 키는 fieldErrors로 옮기지 않는다', () => {
    const result = mapPostgrestError({ code: 'GF409', details: '{"path":"unique_violation"}' });
    expect(result.fieldErrors).toBeUndefined();
    expect(result.diagnostics).toEqual({ path: 'unique_violation' });
  });

  it('폼 필드가 아닌 검증 힌트는 필드 오류로 만들지 않는다', () => {
    const result = mapPostgrestError({ code: 'GF422', details: '{"requestId":"required"}' });
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.fieldErrors).toBeUndefined();
  });

  it('DETAIL에 따라 더 정확한 문장을 고른다', () => {
    expect(
      mapPostgrestError({ code: 'GF410', details: '{"token":"expired"}' }).message,
    ).toContain('만료');
    expect(
      mapPostgrestError({ code: 'GF403', details: '{"space":"bootstrap_not_allowed"}' }).message,
    ).toContain('권한');
    expect(
      mapPostgrestError({ code: 'GF411', details: '{"space":"member_limit"}' }).message,
    ).toContain('정원');
    expect(
      mapPostgrestError({ code: 'GF409', details: '{"space":"already_member_of_other_space"}' })
        .message,
    ).toContain('다른 공간');
    expect(
      mapPostgrestError({ code: 'GF503', details: '{"requestId":"in_progress"}' }).message,
    ).toContain('잠시 후');
  });

  it('모르는 코드는 UNKNOWN이고 원문을 노출하지 않는다', () => {
    const result = mapPostgrestError({ code: 'XX999', message: 'internal detail leak' });
    expect(result.code).toBe('UNKNOWN');
    expect(result.message).not.toContain('internal');
  });
});

describe('mapAuthError', () => {
  it('로그인 실패는 계정 존재 여부를 알려 주지 않는다', () => {
    const result = mapAuthError({ code: 'invalid_credentials', status: 400 });
    expect(result.code).toBe('UNAUTHENTICATED');
    expect(result.message).toBe('이메일 또는 비밀번호가 올바르지 않습니다.');
  });

  it('이메일 미확인과 링크 만료를 구분한다', () => {
    expect(mapAuthError({ code: 'email_not_confirmed' }).code).toBe('FORBIDDEN');
    expect(mapAuthError({ code: 'otp_expired' }).code).toBe('LINK_INVALID');
    expect(mapAuthError({ code: 'flow_state_not_found' }).code).toBe('LINK_INVALID');
  });

  it('요청 한도와 서버 오류는 재시도 가능으로 표시한다', () => {
    expect(mapAuthError({ code: 'over_request_rate_limit' }).code).toBe('RETRYABLE_ERROR');
    expect(mapAuthError({ status: 429 }).code).toBe('RETRYABLE_ERROR');
    expect(mapAuthError({ status: 503 }).code).toBe('RETRYABLE_ERROR');
  });

  it('약한 비밀번호는 비밀번호 필드 오류로 만든다', () => {
    const result = mapAuthError({ code: 'weak_password' });
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.fieldErrors?.password).toBeTruthy();
  });

  it('공개 가입 차단을 권한 오류로 안내한다', () => {
    expect(mapAuthError({ code: 'signup_disabled' }).code).toBe('FORBIDDEN');
  });
});
