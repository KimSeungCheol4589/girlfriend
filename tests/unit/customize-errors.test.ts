import { describe, expect, it } from 'vitest';

import {
  CUSTOMIZE_CODE_MESSAGES,
  customizeFailure,
  fromPhotoResult,
  isDefinitiveCustomizeResult,
  mapCustomizeRpcError,
} from '@/features/customize/errors';

/**
 * 오류 매핑(CONTRACTS.md 0). 분기는 SQLSTATE로만 하고 메시지 문자열을 파싱하지 않는다.
 * 문장은 "무엇이 저장되지 않았는지"를 정확히 말해야 한다.
 */

describe('mapCustomizeRpcError', () => {
  it('SQLSTATE를 앱 코드로 옮긴다', () => {
    expect(mapCustomizeRpcError({ code: 'GF401' }).code).toBe('UNAUTHENTICATED');
    expect(mapCustomizeRpcError({ code: 'GF404' }).code).toBe('NOT_FOUND');
    expect(mapCustomizeRpcError({ code: 'GF409' }).code).toBe('CONFLICT');
    expect(mapCustomizeRpcError({ code: 'GF412' }).code).toBe('UPLOAD_FAILED');
    expect(mapCustomizeRpcError({ code: 'GF422' }).code).toBe('VALIDATION_ERROR');
    expect(mapCustomizeRpcError({ code: 'GF503' }).code).toBe('RETRYABLE_ERROR');
  });

  it('권한 없는 직접 접근은 존재 여부를 알리지 않는다', () => {
    expect(mapCustomizeRpcError({ code: '42501' }).code).toBe('NOT_FOUND');
  });

  it('SQLSTATE가 없으면(DB까지 가지 못함) 재시도 가능으로 둔다', () => {
    expect(mapCustomizeRpcError({ code: '' }).code).toBe('RETRYABLE_ERROR');
    expect(mapCustomizeRpcError(null).code).toBe('RETRYABLE_ERROR');
  });

  it('충돌 문장은 고른 값이 남아 있다는 것을 알린다', () => {
    const failure = mapCustomizeRpcError({
      code: 'GF409',
      details: JSON.stringify({ expectedVersion: 'stale' }),
    });
    expect(failure.code).toBe('CONFLICT');
    expect(failure.message).toContain('고른 값은 그대로');
  });

  it('같은 요청 번호에 다른 입력이면 그 사실을 알린다', () => {
    const failure = mapCustomizeRpcError({
      code: 'GF409',
      details: JSON.stringify({ requestId: 'payload_mismatch' }),
    });
    expect(failure.message).toContain('요청 번호');
  });

  it('DETAIL이 JSON이 아니면 기본 문장을 쓴다(원문을 노출하지 않는다)', () => {
    const failure = mapCustomizeRpcError({ code: 'GF422', details: 'accent color "#zzzzzz" 오류' });
    expect(failure.message).toBe(CUSTOMIZE_CODE_MESSAGES.VALIDATION_ERROR);
  });
});

describe('fromPhotoResult', () => {
  it('성공은 그대로 통과한다', () => {
    expect(fromPhotoResult({ ok: true, data: { assetId: 'x' } })).toEqual({ ok: true, data: { assetId: 'x' } });
  });

  it('사진 자체를 설명하는 문장은 그대로 쓴다', () => {
    const result = fromPhotoResult({
      ok: false,
      code: 'UPLOAD_FAILED',
      message: 'iPhone HEIC 사진은 아직 지원하지 않아요. JPEG·PNG·WebP로 바꿔서 올려 주세요.',
    });
    expect(result).toEqual({
      ok: false,
      code: 'UPLOAD_FAILED',
      message: 'iPhone HEIC 사진은 아직 지원하지 않아요. JPEG·PNG·WebP로 바꿔서 올려 주세요.',
    });
  });

  it('추억 문구는 꾸미기 문장으로 바꾼다', () => {
    const result = fromPhotoResult({ ok: false, code: 'CONFLICT', message: '상대방이 먼저 이 기록을 바꿨습니다.' });
    expect(result).toEqual({ ok: false, code: 'CONFLICT', message: CUSTOMIZE_CODE_MESSAGES.CONFLICT });
  });

  it('사진 기능 꺼짐은 꾸미기 문장으로 바꾼다', () => {
    const result = fromPhotoResult({ ok: false, code: 'PHOTOS_DISABLED', message: '사진을 올릴 수 없습니다.' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('PHOTOS_DISABLED');
      expect(result.message).toBe(CUSTOMIZE_CODE_MESSAGES.PHOTOS_DISABLED);
    }
  });

  it('사진 기능 꺼짐 문장은 막힌 것과 되는 것을 모두 말한다', () => {
    // 정확한 문구는 고정하지 않는다. "새 커버만 막히고 나머지는 그대로"라는 뜻만 확인한다.
    const message = CUSTOMIZE_CODE_MESSAGES.PHOTOS_DISABLED;
    expect(message).toMatch(/커버/);
    expect(message).toMatch(/올릴 수 없|막/);
    expect(message).toMatch(/그대로|유지|계속/);
  });

  it('"아직 안 올라감"은 업로드 단계 재시도 표시를 유지한다', () => {
    const result = fromPhotoResult({
      ok: false,
      code: 'RETRYABLE_ERROR',
      message: '사진 파일이 아직 올라가지 않았어요.',
      retryStage: 'upload',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryStage).toBe('upload');
  });
});

describe('isDefinitiveCustomizeResult', () => {
  it('성공·검증 실패·충돌은 확정이다(다음 저장은 새 키)', () => {
    expect(isDefinitiveCustomizeResult({ ok: true, data: null })).toBe(true);
    expect(isDefinitiveCustomizeResult(customizeFailure('CONFLICT'))).toBe(true);
    expect(isDefinitiveCustomizeResult(customizeFailure('VALIDATION_ERROR'))).toBe(true);
  });

  it('재시도 가능·원인 불명은 확정이 아니다(같은 키 유지)', () => {
    expect(isDefinitiveCustomizeResult(customizeFailure('RETRYABLE_ERROR'))).toBe(false);
    expect(isDefinitiveCustomizeResult(customizeFailure('UNKNOWN'))).toBe(false);
  });
});
