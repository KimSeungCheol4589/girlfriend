import { describe, expect, it, vi } from 'vitest';

import {
  CONFIRMED_ACTION_STALE_MESSAGE,
  calendarFieldMessage,
  confirmedActionMessage,
  isDefinitiveCode,
  logCalendarFailure,
  mapCalendarRpcError,
  validationFailure,
} from '@/features/calendar/errors';

/**
 * 캘린더 RPC 오류 → 화면 결과.
 *
 * 확인하는 것
 *   - SQLSTATE로만 분기한다(메시지 문자열을 파싱하지 않는다).
 *   - DETAIL의 필드 힌트를 폼 오류로 옮긴다. 힌트 값 자체를 사용자에게 보여 주지 않는다.
 *   - 상대방 개인 일정(FORBIDDEN)은 "재시도"로 안내하지 않는다.
 *   - 로그에는 작업 이름·코드·요청 키만 남는다.
 */

function rpcError(code: string, details?: string) {
  return { code, message: 'x', details: details ?? '{}' };
}

describe('mapCalendarRpcError — 코드 변환', () => {
  it('GF 클래스를 앱 코드로 바꾼다', () => {
    expect(mapCalendarRpcError(rpcError('GF401')).code).toBe('UNAUTHENTICATED');
    expect(mapCalendarRpcError(rpcError('GF403')).code).toBe('FORBIDDEN');
    expect(mapCalendarRpcError(rpcError('GF404')).code).toBe('NOT_FOUND');
    expect(mapCalendarRpcError(rpcError('GF409')).code).toBe('CONFLICT');
    expect(mapCalendarRpcError(rpcError('GF422')).code).toBe('VALIDATION_ERROR');
    expect(mapCalendarRpcError(rpcError('GF503')).code).toBe('RETRYABLE_ERROR');
  });

  it('권한 없는 직접 접근(42501)은 존재를 알리지 않는 NOT_FOUND다', () => {
    expect(mapCalendarRpcError(rpcError('42501')).code).toBe('NOT_FOUND');
  });

  it('알 수 없는 코드·응답 없음은 UNKNOWN이고 같은 내용 재시도를 안내한다', () => {
    const failure = mapCalendarRpcError(rpcError(''));
    expect(failure.code).toBe('UNKNOWN');
    expect(failure.message).toContain('같은 내용으로 다시 시도');
  });
});

describe('mapCalendarRpcError — 필드 힌트', () => {
  it('입력 검증 실패는 폼 필드에 붙인다', () => {
    const failure = mapCalendarRpcError(rpcError('GF422', '{"title":"length"}'));
    expect(failure.fieldErrors?.title).toContain('제목');
    expect(failure.message).toBe(failure.fieldErrors?.title);
  });

  it('시각 규칙 위반을 사람이 읽는 문장으로 바꾼다', () => {
    expect(
      mapCalendarRpcError(rpcError('GF422', '{"endTime":"not_after_start"}')).fieldErrors?.endTime,
    ).toContain('시작보다 뒤');
    expect(
      mapCalendarRpcError(rpcError('GF422', '{"startTime":"must_be_null_for_all_day"}')).fieldErrors
        ?.startTime,
    ).toContain('종일');
    expect(
      mapCalendarRpcError(rpcError('GF422', '{"endDate":"before_start"}')).fieldErrors?.endDate,
    ).toContain('앞일 수 없어요');
  });

  it('kind 불변은 새 일정으로 만들라고 안내한다', () => {
    expect(mapCalendarRpcError(rpcError('GF422', '{"kind":"immutable"}')).fieldErrors?.kind).toContain(
      '새 일정',
    );
  });

  it('힌트 원문(예: length)을 그대로 보여 주지 않는다', () => {
    const failure = mapCalendarRpcError(rpcError('GF422', '{"note":"length"}'));
    expect(failure.message).not.toContain('length');
  });

  it('폼 필드가 아닌 키는 필드 오류로 옮기지 않는다', () => {
    const failure = mapCalendarRpcError(rpcError('GF422', '{"ownerId":"not_member"}'));
    expect(failure.fieldErrors).toBeUndefined();
  });

  it('입력 검증이 아닌 코드의 DETAIL은 폼 필드로 옮기지 않는다', () => {
    const failure = mapCalendarRpcError(rpcError('GF409', '{"expectedVersion":"stale"}'));
    expect(failure.fieldErrors).toBeUndefined();
  });

  it('형식이 아닌 DETAIL은 무시한다(사용자 입력이 섞일 수 있다)', () => {
    expect(mapCalendarRpcError(rpcError('GF422', '제목이 너무 깁니다')).fieldErrors).toBeUndefined();
  });
});

describe('mapCalendarRpcError — 충돌과 권한', () => {
  it('버전 충돌은 stale로 표시하고 입력을 지키라고 안내한다', () => {
    const failure = mapCalendarRpcError(rpcError('GF409', '{"expectedVersion":"stale"}'));
    expect(failure.stale).toBe(true);
    expect(failure.message).toContain('그대로 두었으니');
  });

  it('같은 요청 키에 다른 입력은 stale이 아니다', () => {
    const failure = mapCalendarRpcError(rpcError('GF409', '{"requestId":"payload_mismatch"}'));
    expect(failure.stale).toBeUndefined();
    expect(failure.message).toContain('요청 번호');
  });

  it('상대방 개인 일정은 notOwner로 표시하고 재시도를 권하지 않는다', () => {
    const failure = mapCalendarRpcError(rpcError('GF403', '{"ownerId":"not_owner"}'));
    expect(failure.code).toBe('FORBIDDEN');
    expect(failure.notOwner).toBe(true);
    expect(failure.message).toContain('상대방의 개인 일정');
    expect(failure.message).not.toContain('다시 시도');
  });

  it('연결하려던 위시가 사라진 경우를 따로 안내한다', () => {
    const failure = mapCalendarRpcError(rpcError('GF409', '{"wishItemId":"gone"}'));
    expect(failure.message).toContain('위시');
    expect(failure.stale).toBeUndefined();
  });

  it('없는 위시 연결은 다시 고르라고 안내한다', () => {
    expect(mapCalendarRpcError(rpcError('GF404', '{"wishItemId":"missing"}')).message).toContain(
      '다시 골라',
    );
  });

  it('공간 소속이 없으면 그 이유를 알린다', () => {
    expect(mapCalendarRpcError(rpcError('GF404', '{"space":"not_member"}')).message).toContain('공간');
  });
});

describe('confirmedActionMessage', () => {
  it('확인 후 바뀐 경우만 전용 문장을 쓴다', () => {
    const stale = mapCalendarRpcError(rpcError('GF409', '{"expectedVersion":"stale"}'));
    expect(confirmedActionMessage(stale)).toBe(CONFIRMED_ACTION_STALE_MESSAGE);

    const notFound = mapCalendarRpcError(rpcError('GF404', '{"eventId":"missing"}'));
    expect(confirmedActionMessage(notFound)).toBe(notFound.message);
  });
});

describe('isDefinitiveCode', () => {
  it('재시도 가능·원인 불명만 불확실이다', () => {
    expect(isDefinitiveCode('RETRYABLE_ERROR')).toBe(false);
    expect(isDefinitiveCode('UNKNOWN')).toBe(false);
    for (const code of ['CONFLICT', 'NOT_FOUND', 'FORBIDDEN', 'VALIDATION_ERROR'] as const) {
      expect(isDefinitiveCode(code)).toBe(true);
    }
  });
});

describe('calendarFieldMessage / validationFailure / logCalendarFailure', () => {
  it('모르는 조합은 일반 안내다', () => {
    expect(calendarFieldMessage('title', 'unknown_reason')).toBe('입력을 다시 확인해 주세요.');
  });

  it('첫 필드 오류를 요약 문장으로 쓴다', () => {
    const failure = validationFailure({ title: '제목을 확인해 주세요.' });
    expect(failure.code).toBe('VALIDATION_ERROR');
    expect(failure.message).toBe('제목을 확인해 주세요.');
  });

  it('로그에는 작업 이름·코드·요청 키만 남는다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logCalendarFailure('saveCalendarEvent', 'CONFLICT', 'req-1');
    expect(spy).toHaveBeenCalledWith('calendar.saveCalendarEvent code=CONFLICT requestId=req-1');
    spy.mockRestore();
  });
});
