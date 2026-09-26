import { describe, expect, it } from 'vitest';

import { MEMORY_CODE_MESSAGES, isDefinitiveMemoryResult } from '@/features/memories/live/errors';
import {
  LINK_CODE_MESSAGES,
  SOURCE_DELETE_BLOCKED_MESSAGES,
  linkFailure,
  mapLinkRpcError,
} from '@/features/memories/links/errors';

/**
 * 연결 RPC의 오류 → 화면 문장 계약.
 *
 * 지키려는 것
 *   1. 분기는 SQLSTATE로만 한다(CONTRACTS.md 0). 메시지 문자열을 파싱하지 않는다.
 *   2. **확정 실패**("완료가 아니다", "사라졌다")를 "다시 시도하면 된다"로 안내하지 않는다.
 *      그러면 사용자가 원인을 모른 채 같은 버튼을 반복한다.
 *   3. 연결이 실패했을 때 **기록과 사진은 남아 있다**는 사실을 알린다.
 *   4. DB 힌트 원문(`not_done`·`has_memories` 등)을 사용자에게 보여 주지 않는다.
 *   5. 응답이 확정적이면 다음 시도는 새 requestId를 쓴다.
 */

function rpcError(code: string, details?: string) {
  return { code, message: 'ignored', details: details ?? '{}' };
}

describe('SQLSTATE 매핑', () => {
  it('계약된 코드를 앱 코드로 옮긴다', () => {
    expect(mapLinkRpcError(rpcError('GF401')).code).toBe('UNAUTHENTICATED');
    expect(mapLinkRpcError(rpcError('GF404')).code).toBe('NOT_FOUND');
    expect(mapLinkRpcError(rpcError('GF409')).code).toBe('CONFLICT');
    expect(mapLinkRpcError(rpcError('GF422')).code).toBe('VALIDATION_ERROR');
    expect(mapLinkRpcError(rpcError('GF503')).code).toBe('RETRYABLE_ERROR');
  });

  it('권한 없는 직접 접근(42501)은 존재를 알리지 않는다', () => {
    expect(mapLinkRpcError(rpcError('42501')).code).toBe('NOT_FOUND');
  });

  it('FK 위반(23503)은 UNKNOWN이 아니라 CONFLICT다(무한 재시도를 안내하지 않는다)', () => {
    const failure = mapLinkRpcError(rpcError('23503'));
    expect(failure.code).toBe('CONFLICT');
    expect(isDefinitiveMemoryResult(failure)).toBe(true);
  });

  it('SQLSTATE가 비어 있으면(요청이 DB에 닿지 못함) 재시도 가능으로 둔다', () => {
    const failure = mapLinkRpcError(rpcError(''));
    expect(failure.code).toBe('RETRYABLE_ERROR');
    // 처리됐는지 알 수 없으므로 같은 requestId를 유지해야 한다.
    expect(isDefinitiveMemoryResult(failure)).toBe(false);
  });

  it('알 수 없는 SQLSTATE는 UNKNOWN이다', () => {
    expect(mapLinkRpcError(rpcError('XX000')).code).toBe('UNKNOWN');
    expect(mapLinkRpcError(null).code).toBe('RETRYABLE_ERROR');
  });
});

describe('원본이 완료 상태가 아닐 때', () => {
  const eventNotDone = rpcError('GF409', '{"eventId":"not_done"}');
  const wishNotDone = rpcError('GF409', '{"wishId":"not_done"}');

  it('무엇을 먼저 해야 하는지 알려 준다', () => {
    expect(mapLinkRpcError(eventNotDone).message).toContain('완료 체크');
    expect(mapLinkRpcError(wishNotDone).message).toContain('완료로 바꾼 뒤');
  });

  it('일반 충돌 안내를 쓰지 않는다', () => {
    expect(mapLinkRpcError(eventNotDone).message).not.toBe(LINK_CODE_MESSAGES.CONFLICT);
    expect(mapLinkRpcError(eventNotDone).message).not.toBe(MEMORY_CODE_MESSAGES.CONFLICT);
  });

  it('DB 힌트 원문을 노출하지 않는다', () => {
    expect(mapLinkRpcError(eventNotDone).message).not.toContain('not_done');
  });

  it('확정 실패라 같은 요청 키를 다시 쓰지 않는다', () => {
    expect(isDefinitiveMemoryResult(mapLinkRpcError(eventNotDone))).toBe(true);
  });
});

describe('연결 중 원본이 사라졌을 때', () => {
  it('기록·사진이 남아 있다고 알리고 다른 선택지를 준다', () => {
    for (const details of ['{"eventId":"gone"}', '{"wishId":"gone"}']) {
      const message = mapLinkRpcError(rpcError('GF409', details)).message;
      expect(message).toContain('기록과 사진은 그대로');
      expect(message).toMatch(/다른 계획|연결 없이/);
    }
  });
});

describe('버전 충돌', () => {
  const stale = rpcError('GF409', '{"expectedVersion":"stale"}');

  it('상대가 먼저 바꿨다고 알리고 기록이 남아 있음을 알린다', () => {
    const message = mapLinkRpcError(stale).message;
    expect(message).toContain('상대방이 먼저');
    expect(message).toContain('기록과 사진은 그대로');
  });

  it('같은 요청 키를 재사용하지 않는다', () => {
    expect(isDefinitiveMemoryResult(mapLinkRpcError(stale))).toBe(true);
  });
});

describe('중복 요청', () => {
  it('같은 키에 다른 입력은 원인을 알려 준다', () => {
    const message = mapLinkRpcError(rpcError('GF409', '{"requestId":"payload_mismatch"}')).message;
    expect(message).toContain('요청 번호');
    expect(message).not.toContain('payload_mismatch');
  });

  it('처리 중(in_progress)은 재시도 가능으로 안내한다', () => {
    const failure = mapLinkRpcError(rpcError('GF503', '{"requestId":"in_progress"}'));
    expect(failure.code).toBe('RETRYABLE_ERROR');
    expect(failure.message).toContain('잠시 후');
    expect(isDefinitiveMemoryResult(failure)).toBe(false);
  });
});

describe('찾을 수 없는 대상', () => {
  it('일정·위시·추억·연결을 구분해 안내한다', () => {
    expect(mapLinkRpcError(rpcError('GF404', '{"eventId":"missing"}')).message).toContain('일정');
    expect(mapLinkRpcError(rpcError('GF404', '{"wishId":"missing"}')).message).toContain('위시');
    expect(mapLinkRpcError(rpcError('GF404', '{"memoryId":"missing"}')).message).toContain('기록');
    expect(mapLinkRpcError(rpcError('GF404', '{"memoryLink":"missing"}')).message).toContain(
      '이미 연결이 없어요',
    );
  });

  it('없는 대상 안내는 존재 여부를 단정하지 않는다', () => {
    const message = mapLinkRpcError(rpcError('GF404', '{"eventId":"missing"}')).message;
    expect(message).toMatch(/지워졌거나|다른 공간/);
  });
});

describe('검증 오류', () => {
  it('허용하지 않는 종류·빈 대상을 구분한다', () => {
    expect(mapLinkRpcError(rpcError('GF422', '{"source":"allowed"}')).message).toContain(
      '알 수 없는 연결 종류',
    );
    expect(mapLinkRpcError(rpcError('GF422', '{"sourceId":"required"}')).message).toContain(
      '고르지 않았어요',
    );
  });

  it('연결은 폼 필드가 없으므로 fieldErrors를 만들지 않는다', () => {
    expect(mapLinkRpcError(rpcError('GF422', '{"source":"allowed"}')).fieldErrors).toBeUndefined();
  });
});

describe('기본 문장', () => {
  it('모든 코드에 사람이 읽는 문장이 있다', () => {
    for (const message of Object.values(LINK_CODE_MESSAGES)) {
      expect(message.length).toBeGreaterThan(5);
    }
  });

  it('linkFailure는 코드의 기본 문장을 쓴다', () => {
    expect(linkFailure('RETRYABLE_ERROR').message).toBe(LINK_CODE_MESSAGES.RETRYABLE_ERROR);
    expect(linkFailure('UNKNOWN', '직접 문장').message).toBe('직접 문장');
  });

  it('연결 문맥의 문장은 추억 저장 문장과 다르다', () => {
    expect(LINK_CODE_MESSAGES.CONFLICT).not.toBe(MEMORY_CODE_MESSAGES.CONFLICT);
    expect(LINK_CODE_MESSAGES.NOT_FOUND).not.toBe(MEMORY_CODE_MESSAGES.NOT_FOUND);
  });
});

describe('원본 삭제 거부 안내 계약', () => {
  /**
   * 이 문장을 **쓰는 곳**은 캘린더·위시 화면의 오류 매퍼다(이 작업의 파일 범위 밖).
   * 계약은 연결을 만든 쪽에서 정의해 두고, 반영은 승인 뒤 해당 파일에서 한다.
   */
  it('무엇을 먼저 정리해야 하는지 알려 준다', () => {
    for (const message of Object.values(SOURCE_DELETE_BLOCKED_MESSAGES)) {
      expect(message).toContain('지울 수 없어요');
      expect(message).toMatch(/연결된 추억을 지우거나|연결을 해제/);
      expect(message).not.toContain('has_memories');
    }
  });

  it('일정과 위시를 구분한다', () => {
    expect(SOURCE_DELETE_BLOCKED_MESSAGES['eventId:has_memories']).toContain('일정');
    expect(SOURCE_DELETE_BLOCKED_MESSAGES['wishId:has_memories']).toContain('위시');
  });
});
