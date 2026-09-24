import { describe, expect, it } from 'vitest';

import { isDefinitiveCode as isDefinitiveCalendarCode } from '@/features/calendar/errors';
import { mapPostgrestError, messageForCode } from '@/features/auth/errors';
import { confirmedActionMessage, isDefinitiveCode, mapWishRpcError } from '@/features/wishes/errors';

/**
 * CAL-001에서 정한 "위시 삭제 의미"의 앱 오류 계약.
 *
 * 연결된 캘린더 일정이 있는 위시는 지워지지 않고 `GF409 {"wishId":"has_calendar_events"}`로 거부된다.
 * 이 테스트가 지키려는 것은 두 가지다.
 *
 *   1. 사용자가 **왜** 지울 수 없는지 알 수 있어야 한다. 일반 충돌 안내("최신 내용을 불러온 뒤 다시
 *      시도")가 나가면 다시 시도해도 결과가 같아 사용자가 원인을 모른 채 반복하게 된다.
 *   2. 외래 키 위반(`23503`)이 `UNKNOWN`으로 떨어져 "같은 내용으로 다시 시도하면 된다"고
 *      **틀린 안내**를 하지 않아야 한다. 그 요청은 확정적으로 거부된 것이다.
 */

function rpcError(code: string, details?: string) {
  return { code, message: 'x', details: details ?? '{}' };
}

const LINKED = rpcError('GF409', '{"wishId":"has_calendar_events"}');

describe('연결된 일정이 있는 위시 삭제', () => {
  it('CONFLICT이며 원인을 문장으로 알린다', () => {
    const failure = mapWishRpcError(LINKED);
    expect(failure.code).toBe('CONFLICT');
    expect(failure.message).toContain('캘린더 일정');
    expect(failure.message).toContain('지울 수 없어요');
  });

  it('일반 충돌 안내(먼저 저장된 변경)를 쓰지 않는다', () => {
    const failure = mapWishRpcError(LINKED);
    expect(failure.message).not.toBe(messageForCode('CONFLICT'));
    // 버전 충돌이 아니므로 stale로 표시하지 않는다(확인 창 문장도 쓰지 않는다).
    expect(failure.stale).toBeUndefined();
    expect(confirmedActionMessage(failure)).toBe(failure.message);
  });

  it('무엇을 먼저 해야 하는지 알려 준다', () => {
    const message = mapWishRpcError(LINKED).message;
    expect(message).toMatch(/먼저 지우거나|연결을 해제/);
  });

  it('확정 응답이라 같은 요청 키를 다시 쓰지 않는다', () => {
    expect(isDefinitiveCode('CONFLICT')).toBe(true);
  });

  it('힌트 원문을 사용자에게 보여 주지 않는다', () => {
    expect(mapWishRpcError(LINKED).message).not.toContain('has_calendar_events');
  });

  it('입력 검증이 아니므로 폼 필드 오류로 옮기지 않는다', () => {
    expect(mapWishRpcError(LINKED).fieldErrors).toBeUndefined();
  });
});

describe('외래 키 위반(23503) 매핑', () => {
  it('UNKNOWN이 아니라 CONFLICT다', () => {
    expect(mapPostgrestError(rpcError('23503')).code).toBe('CONFLICT');
  });

  it('"같은 내용으로 다시 시도"라고 안내하지 않는다', () => {
    const failure = mapWishRpcError(rpcError('23503'));
    expect(failure.code).toBe('CONFLICT');
    expect(failure.message).not.toContain('같은 내용으로 다시 시도');
  });

  it('확정 응답이라 요청 키를 재사용하지 않는다(무한 재시도를 만들지 않는다)', () => {
    const failure = mapWishRpcError(rpcError('23503'));
    expect(isDefinitiveCode(failure.code)).toBe(true);
    expect(isDefinitiveCalendarCode(failure.code)).toBe(true);
  });

  it('DETAIL에 힌트가 실려 오면 그 문장을 쓴다', () => {
    expect(mapPostgrestError(LINKED).message).toContain('캘린더 일정');
  });
});
