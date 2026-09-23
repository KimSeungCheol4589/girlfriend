import { describe, expect, it, vi } from 'vitest';

import {
  CONFIRMED_ACTION_STALE_MESSAGE,
  confirmedActionMessage,
  isDefinitiveCode,
  logWishFailure,
  mapWishRpcError,
  validationFailure,
} from '@/features/wishes/errors';

/**
 * RPC 오류 매핑 단위 테스트.
 *
 * 계약(CONTRACTS.md 0): 분기는 SQLSTATE로 하고 DETAIL에는 필드 힌트만 들어 있다.
 * 사용자 입력·DB 원문은 화면 문장과 로그 어디에도 넣지 않는다.
 */

describe('mapWishRpcError', () => {
  it('SQLSTATE를 앱 오류 코드로 옮긴다', () => {
    expect(mapWishRpcError({ code: 'GF401' }).code).toBe('UNAUTHENTICATED');
    expect(mapWishRpcError({ code: 'GF404' }).code).toBe('NOT_FOUND');
    expect(mapWishRpcError({ code: 'GF409' }).code).toBe('CONFLICT');
    expect(mapWishRpcError({ code: 'GF422' }).code).toBe('VALIDATION_ERROR');
    expect(mapWishRpcError({ code: 'GF503' }).code).toBe('RETRYABLE_ERROR');
    // 권한 없는 직접 접근은 존재 여부를 알리지 않도록 NOT_FOUND로 통일한다.
    expect(mapWishRpcError({ code: '42501' }).code).toBe('NOT_FOUND');
    expect(mapWishRpcError({ code: '' }).code).toBe('UNKNOWN');
    expect(mapWishRpcError(null).code).toBe('UNKNOWN');
  });

  it('입력 오류의 필드 힌트를 폼 필드 오류로 옮긴다', () => {
    const failure = mapWishRpcError({ code: 'GF422', details: '{"title":"length"}' });
    expect(failure.code).toBe('VALIDATION_ERROR');
    expect(failure.fieldErrors?.title).toContain('제목');
    expect(failure.message).toBe(failure.fieldErrors?.title);
  });

  it('링크·분류·상태·계획일 힌트에도 문장을 붙인다', () => {
    expect(
      mapWishRpcError({ code: 'GF422', details: '{"linkUrl":"https_required"}' }).fieldErrors?.linkUrl,
    ).toContain('https');
    expect(
      mapWishRpcError({ code: 'GF422', details: '{"category":"allowed"}' }).fieldErrors?.category,
    ).toBeTruthy();
    expect(
      mapWishRpcError({ code: 'GF422', details: '{"status":"allowed"}' }).fieldErrors?.status,
    ).toBeTruthy();
    expect(
      mapWishRpcError({ code: 'GF422', details: '{"plannedDate":"must_be_null"}' }).fieldErrors
        ?.plannedDate,
    ).toBeTruthy();
  });

  it('폼 필드가 아닌 DETAIL 키는 필드 오류로 만들지 않는다', () => {
    const failure = mapWishRpcError({ code: 'GF422', details: '{"expectedVersion":"must_be_zero_on_create"}' });
    expect(failure.fieldErrors).toBeUndefined();
    expect(failure.message).toBeTruthy();
  });

  it('버전 충돌은 stale 표시와 안내 문장을 함께 준다', () => {
    const failure = mapWishRpcError({ code: 'GF409', details: '{"expectedVersion":"stale"}' });
    expect(failure.code).toBe('CONFLICT');
    expect(failure.stale).toBe(true);
    expect(failure.message).toContain('상대방');
  });

  it('같은 요청 키에 다른 입력을 보낸 경우를 구분해 안내한다', () => {
    const failure = mapWishRpcError({ code: 'GF409', details: '{"requestId":"payload_mismatch"}' });
    expect(failure.stale).toBeUndefined();
    expect(failure.message).toContain('요청 번호');
  });

  it('처리 중 재시도는 같은 내용으로 다시 보내라고 안내한다', () => {
    const failure = mapWishRpcError({ code: 'GF503', details: '{"requestId":"in_progress"}' });
    expect(failure.code).toBe('RETRYABLE_ERROR');
    expect(failure.message).toContain('처리하는 중');
  });

  it('공간 소속이 아니면 존재 여부 대신 참여 안내를 준다', () => {
    const failure = mapWishRpcError({ code: 'GF404', details: '{"space":"not_member"}' });
    expect(failure.code).toBe('NOT_FOUND');
    expect(failure.message).toContain('공간');
  });

  it('DB 메시지 원문을 화면 문장에 넣지 않는다', () => {
    const failure = mapWishRpcError({
      code: 'GF409',
      message: 'CONFLICT',
      details: '{"expectedVersion":"stale"}',
      hint: 'internal hint',
    });
    expect(failure.message).not.toContain('internal hint');
    expect(failure.message).not.toContain('GF409');
  });

  it('형식이 깨진 DETAIL은 무시한다(사용자 입력이 섞일 수 있다)', () => {
    const failure = mapWishRpcError({ code: 'GF422', details: '내 비밀 메모' });
    expect(failure.fieldErrors).toBeUndefined();
    expect(failure.message).not.toContain('비밀');
  });
});

describe('confirmedActionMessage', () => {
  it('확인형 작업의 버전 충돌에는 다시 확인하라고 안내한다', () => {
    const stale = mapWishRpcError({ code: 'GF409', details: '{"expectedVersion":"stale"}' });
    expect(confirmedActionMessage(stale)).toBe(CONFIRMED_ACTION_STALE_MESSAGE);
  });

  it('그 밖의 실패는 원래 문장을 그대로 쓴다', () => {
    const notFound = mapWishRpcError({ code: 'GF404' });
    expect(confirmedActionMessage(notFound)).toBe(notFound.message);
  });
});

describe('isDefinitiveCode', () => {
  it('서버가 결과를 확정해 준 코드만 true다', () => {
    expect(isDefinitiveCode('CONFLICT')).toBe(true);
    expect(isDefinitiveCode('VALIDATION_ERROR')).toBe(true);
    expect(isDefinitiveCode('NOT_FOUND')).toBe(true);
    // 아래 둘은 서버가 처리했는지 알 수 없다 → 같은 요청 키를 유지해야 한다.
    expect(isDefinitiveCode('RETRYABLE_ERROR')).toBe(false);
    expect(isDefinitiveCode('UNKNOWN')).toBe(false);
  });
});

describe('logWishFailure', () => {
  it('작업 이름·코드·요청 키만 남긴다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logWishFailure('saveWish', 'CONFLICT', 'req-1');
    expect(spy).toHaveBeenCalledWith('wishes.saveWish code=CONFLICT requestId=req-1');
    spy.mockRestore();
  });
});

describe('validationFailure', () => {
  it('첫 필드 오류를 상단 문장으로 쓴다', () => {
    const failure = validationFailure({ title: '제목을 입력해 주세요.' });
    expect(failure.code).toBe('VALIDATION_ERROR');
    expect(failure.message).toBe('제목을 입력해 주세요.');
    expect(failure.fieldErrors?.title).toBeTruthy();
  });
});
