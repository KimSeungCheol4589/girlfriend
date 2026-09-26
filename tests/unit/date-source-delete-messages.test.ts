import { describe, expect, it } from 'vitest';

import { mapCalendarRpcError } from '@/features/calendar/errors';
import { mapWishRpcError } from '@/features/wishes/errors';

/**
 * 원본(일정·위시) 삭제가 연결된 데이트 기록 때문에 거부될 때의 안내 계약(DATE-001).
 *
 * 지키려는 것
 *   1. DB는 `GF409 {"eventId":"has_memories"}` / `{"wishId":"has_memories"}`로 거부한다.
 *      이 경우 일반 CONFLICT 문장("최신 내용을 불러온 뒤 다시 시도")을 쓰면 안 된다.
 *      다시 시도해도 결과가 같아서 사용자가 원인을 모른 채 반복하게 된다.
 *   2. 무엇을 먼저 해야 하는지(연결 해제 또는 기록 삭제)를 문장에 담는다.
 *   3. DB 힌트 원문(`has_memories`)은 화면에 내보내지 않는다.
 *   4. 확정 실패이므로 재시도 대상으로 분류하지 않는다.
 */

function rpcError(details: string) {
  return { code: 'GF409', message: 'ignored', details };
}

const GENERIC_CONFLICT = '상대방이 먼저 바꾼 내용이 있어';

describe('일정 삭제 거부 안내', () => {
  const failure = mapCalendarRpcError(rpcError('{"eventId":"has_memories"}'));

  it('전용 문장을 쓴다(일반 충돌 문장이 아니다)', () => {
    expect(failure.code).toBe('CONFLICT');
    expect(failure.message).not.toContain(GENERIC_CONFLICT);
    expect(failure.message).toContain('데이트 기록');
  });

  it('먼저 할 일을 알려 준다', () => {
    expect(failure.message).toContain('연결을 해제');
  });

  it('DB 힌트 원문을 보여 주지 않는다', () => {
    expect(failure.message).not.toContain('has_memories');
    expect(failure.message).not.toContain('eventId');
  });
});

describe('위시 삭제 거부 안내', () => {
  const failure = mapWishRpcError(rpcError('{"wishId":"has_memories"}'));

  it('전용 문장을 쓴다(일반 충돌 문장이 아니다)', () => {
    expect(failure.code).toBe('CONFLICT');
    expect(failure.message).not.toContain(GENERIC_CONFLICT);
    expect(failure.message).toContain('데이트 기록');
  });

  it('먼저 할 일을 알려 준다', () => {
    expect(failure.message).toContain('연결을 해제');
  });

  it('DB 힌트 원문을 보여 주지 않는다', () => {
    expect(failure.message).not.toContain('has_memories');
    expect(failure.message).not.toContain('wishId');
  });

  it('일정 연결 거부(has_calendar_events)와 다른 문장이다', () => {
    const calendarBlocked = mapWishRpcError(rpcError('{"wishId":"has_calendar_events"}'));
    expect(calendarBlocked.message).not.toBe(failure.message);
    expect(calendarBlocked.message).toContain('캘린더');
  });
});
