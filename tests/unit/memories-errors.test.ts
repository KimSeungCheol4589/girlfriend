import { describe, expect, it } from 'vitest';

import {
  isDefinitiveMemoryResult,
  mapMemoryRpcError,
  memoryFailure,
} from '@/features/memories/live/errors';

describe('mapMemoryRpcError', () => {
  it('SQLSTATE로 분기한다', () => {
    expect(mapMemoryRpcError({ code: 'GF401' }).code).toBe('UNAUTHENTICATED');
    expect(mapMemoryRpcError({ code: 'GF404' }).code).toBe('NOT_FOUND');
    expect(mapMemoryRpcError({ code: 'GF409' }).code).toBe('CONFLICT');
    expect(mapMemoryRpcError({ code: 'GF412' }).code).toBe('UPLOAD_FAILED');
    expect(mapMemoryRpcError({ code: 'GF503' }).code).toBe('RETRYABLE_ERROR');
    expect(mapMemoryRpcError({ code: '23505' }).code).toBe('CONFLICT');
  });

  it('권한 오류(42501)는 존재 여부를 알리지 않도록 NOT_FOUND', () => {
    expect(mapMemoryRpcError({ code: '42501', message: 'permission denied for function x' }).code).toBe(
      'NOT_FOUND',
    );
  });

  it('SQLSTATE가 없으면(요청이 DB까지 가지 못함) 재시도 가능으로 본다', () => {
    const failure = mapMemoryRpcError({ code: '', message: 'TypeError: fetch failed' });
    expect(failure.code).toBe('RETRYABLE_ERROR');
    // DB·네트워크 원문을 화면 문장으로 쓰지 않는다.
    expect(failure.message.includes('fetch failed')).toBe(false);
  });

  it('검증 실패 DETAIL을 폼 필드 오류로 옮긴다', () => {
    const failure = mapMemoryRpcError({ code: 'GF422', details: '{"memoryDate":"future_date"}' });
    expect(failure.code).toBe('VALIDATION_ERROR');
    expect(failure.fieldErrors?.memoryDate).toContain('오늘');
    expect(failure.message).toBe(failure.fieldErrors?.memoryDate);
  });

  it('사진 오류는 사진 영역 필드로 옮긴다', () => {
    const failure = mapMemoryRpcError({ code: 'GF422', details: '{"photoAssetIds":"not_ready"}' });
    expect(failure.fieldErrors?.photos).toBeDefined();

    const missing = mapMemoryRpcError({ code: 'GF404', details: '{"photoAssetIds":"missing"}' });
    expect(missing.code).toBe('NOT_FOUND');
    expect(missing.fieldErrors?.photos).toBeDefined();
  });

  it('필드가 아닌 키(path, requestId)는 필드 오류로 옮기지 않는다', () => {
    const failure = mapMemoryRpcError({ code: 'GF422', details: '{"expectedVersion":"required","path":"x"}' });
    expect(failure.fieldErrors).toBeUndefined();
  });

  it('같은 키·다른 입력은 별도 안내', () => {
    const failure = mapMemoryRpcError({ code: 'GF409', details: '{"requestId":"payload_mismatch"}' });
    expect(failure.code).toBe('CONFLICT');
    expect(failure.message).toContain('요청 번호');
  });

  it('형식이 틀린 DETAIL은 무시한다(사용자 입력이 섞일 수 있다)', () => {
    const failure = mapMemoryRpcError({ code: 'GF422', details: 'title too long: 사용자본문' });
    expect(failure.fieldErrors).toBeUndefined();
    expect(failure.message.includes('사용자본문')).toBe(false);
  });
});

describe('isDefinitiveMemoryResult', () => {
  it('성공·검증 실패·충돌은 확정, 재시도 가능·원인 불명은 미확정', () => {
    expect(isDefinitiveMemoryResult({ ok: true, data: null })).toBe(true);
    expect(isDefinitiveMemoryResult(memoryFailure('VALIDATION_ERROR'))).toBe(true);
    expect(isDefinitiveMemoryResult(memoryFailure('CONFLICT'))).toBe(true);
    expect(isDefinitiveMemoryResult(memoryFailure('RETRYABLE_ERROR'))).toBe(false);
    expect(isDefinitiveMemoryResult(memoryFailure('UNKNOWN'))).toBe(false);
  });
});
