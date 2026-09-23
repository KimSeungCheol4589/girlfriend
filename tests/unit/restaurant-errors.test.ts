import { describe, expect, it } from 'vitest';

import {
  CONFIRMED_ACTION_STALE_MESSAGE,
  confirmedActionMessage,
  isDefinitiveCode,
  mapRestaurantRpcError,
} from '@/features/restaurants/errors';

describe('확인형 작업(방문 취소·삭제)의 충돌 문장', () => {
  it('버전 충돌은 "확인한 뒤 정보나 후기가 바뀌었다"로 알린다(후기 변경도 버전을 올린다)', () => {
    const stale = mapRestaurantRpcError({ code: 'GF409', details: '{"expectedVersion":"stale"}' });
    expect(stale.stale).toBe(true);
    expect(confirmedActionMessage(stale)).toBe(CONFIRMED_ACTION_STALE_MESSAGE);
    expect(CONFIRMED_ACTION_STALE_MESSAGE).toContain('아무것도 바꾸지 않았어요');
  });

  it('확인 필요·요청 불일치·그 밖의 실패는 원래 문장을 쓴다', () => {
    const confirm = mapRestaurantRpcError({ code: 'GF409', details: '{"confirmDeleteReviews":"required"}' });
    expect(confirm.stale).toBeUndefined();
    expect(confirmedActionMessage(confirm)).toBe(confirm.message);

    const mismatch = mapRestaurantRpcError({ code: 'GF409', details: '{"requestId":"payload_mismatch"}' });
    expect(confirmedActionMessage(mismatch)).toBe(mismatch.message);

    const missing = mapRestaurantRpcError({ code: 'GF404', details: '{"restaurantId":"missing"}' });
    expect(confirmedActionMessage(missing)).toBe(missing.message);
  });

  it('정보 수정 충돌 문장은 후기 변경도 원인일 수 있음을 알린다', () => {
    const stale = mapRestaurantRpcError({ code: 'GF409', details: '{"expectedVersion":"stale"}' });
    expect(stale.message).toContain('정보·방문 상태·후기');
  });
});

describe('mapRestaurantRpcError', () => {
  it('GF422 필드 힌트를 맛집 필드 오류로 옮긴다', () => {
    const result = mapRestaurantRpcError({
      code: 'GF422',
      message: 'VALIDATION_ERROR',
      details: '{"mapUrl":"host_not_allowed"}',
    });
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.fieldErrors).toEqual({ mapUrl: '네이버 지도·카카오맵 공유 링크만 저장할 수 있어요.' });
    expect(result.message).toBe(result.fieldErrors?.mapUrl);
  });

  it('방문일·별점·후기 힌트도 필드로 옮긴다', () => {
    expect(
      mapRestaurantRpcError({ code: 'GF422', details: '{"visitedDate":"future_date"}' }).fieldErrors,
    ).toEqual({ visitedDate: '방문일은 오늘보다 뒤일 수 없어요.' });
    expect(mapRestaurantRpcError({ code: 'GF422', details: '{"rating":"range"}' }).fieldErrors?.rating).toBeTruthy();
    expect(mapRestaurantRpcError({ code: 'GF422', details: '{"comment":"length"}' }).fieldErrors?.comment).toBeTruthy();
  });

  it('입력 필드가 아닌 힌트(requestId 등)는 필드 오류로 옮기지 않는다', () => {
    const result = mapRestaurantRpcError({ code: 'GF422', details: '{"requestId":"required"}' });
    expect(result.fieldErrors).toBeUndefined();
    expect(result.message).toBe('입력을 다시 확인해 주세요.');
  });

  it('버전 충돌은 입력을 유지한다는 안내와 함께 CONFLICT다', () => {
    const result = mapRestaurantRpcError({ code: 'GF409', details: '{"expectedVersion":"stale"}' });
    expect(result.code).toBe('CONFLICT');
    expect(result.message).toContain('먼저 바꾼 내용');
    expect(result.needsReviewConfirmation).toBeUndefined();
  });

  it('후기 삭제 확인이 필요하면 표시한다', () => {
    const result = mapRestaurantRpcError({ code: 'GF409', details: '{"confirmDeleteReviews":"required"}' });
    expect(result.code).toBe('CONFLICT');
    expect(result.needsReviewConfirmation).toBe(true);
    expect(result.message).toContain('아무것도 바꾸지 않았어요');
  });

  it('방문 완료가 아니라 후기를 못 쓰면 표시한다', () => {
    const result = mapRestaurantRpcError({ code: 'GF409', details: '{"restaurant":"not_visited"}' });
    expect(result.notVisited).toBe(true);
  });

  it('권한 오류(42501)·없음(GF404)은 같은 NOT_FOUND로 존재 여부를 숨긴다', () => {
    const denied = mapRestaurantRpcError({ code: '42501', message: 'permission denied for function x' });
    const missing = mapRestaurantRpcError({ code: 'GF404', details: '{"restaurantId":"missing"}' });
    expect(denied.code).toBe('NOT_FOUND');
    expect(missing.code).toBe('NOT_FOUND');
    expect(denied.message).toBe(missing.message);
  });

  it('DB 원문 메시지·DETAIL 원문을 화면 문장에 싣지 않는다', () => {
    const result = mapRestaurantRpcError({
      code: 'XX000',
      message: 'secret internal text 성수 파스타',
      details: 'not json: user memo',
    });
    expect(result.code).toBe('UNKNOWN');
    expect(result.message).not.toContain('secret');
    expect(result.message).not.toContain('memo');
    expect(result.fieldErrors).toBeUndefined();
  });

  it('원인 불명·재시도 가능은 "저장됐는지 모름"으로 안내한다', () => {
    expect(mapRestaurantRpcError({ code: '' }).message).toContain('같은 내용으로 다시 시도');
    expect(mapRestaurantRpcError({ code: 'GF503', details: '{"requestId":"in_progress"}' }).code).toBe(
      'RETRYABLE_ERROR',
    );
  });
});

describe('isDefinitiveCode', () => {
  it('재시도 가능·원인 불명만 미확정이다', () => {
    expect(isDefinitiveCode('RETRYABLE_ERROR')).toBe(false);
    expect(isDefinitiveCode('UNKNOWN')).toBe(false);
    for (const code of ['CONFLICT', 'VALIDATION_ERROR', 'NOT_FOUND', 'UNAUTHENTICATED'] as const) {
      expect(isDefinitiveCode(code)).toBe(true);
    }
  });
});
