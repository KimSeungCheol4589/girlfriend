import { describe, expect, it } from 'vitest';

import {
  SESSION_CHANNEL_NAME,
  SESSION_SIGNAL_STORAGE_KEY,
  createSignedOutSignal,
  parseSessionSignal,
  parseSessionSignalJson,
} from '@/features/auth/session-channel';

/**
 * 탭 간 로그아웃 알림의 형식을 고정한다.
 * 알림에는 비밀이 없어야 하고, 우리가 보낸 신호만 받아들여야 한다.
 */
describe('createSignedOutSignal', () => {
  it('종류와 시각만 담는다 (비밀 없음)', () => {
    const signal = createSignedOutSignal(1_700_000_000_000);
    expect(signal).toEqual({ type: 'signed-out', at: 1_700_000_000_000 });
    expect(Object.keys(signal).sort()).toEqual(['at', 'type']);
  });
});

describe('parseSessionSignal', () => {
  it('우리가 보낸 신호만 받아들인다', () => {
    expect(parseSessionSignal({ type: 'signed-out', at: 1 })).toEqual({
      type: 'signed-out',
      at: 1,
    });
  });

  it('다른 메시지는 무시한다', () => {
    expect(parseSessionSignal({ type: 'signed-in', at: 1 })).toBeNull();
    expect(parseSessionSignal({ type: 'signed-out' })).toBeNull();
    expect(parseSessionSignal({ type: 'signed-out', at: 'now' })).toBeNull();
    expect(parseSessionSignal(null)).toBeNull();
    expect(parseSessionSignal('signed-out')).toBeNull();
    expect(parseSessionSignal(undefined)).toBeNull();
  });

  it('저장소 값이 손상돼도 예외를 던지지 않는다', () => {
    expect(parseSessionSignalJson('not json')).toBeNull();
    expect(parseSessionSignalJson(null)).toBeNull();
    expect(parseSessionSignalJson('{"type":"signed-out","at":5}')).toEqual({
      type: 'signed-out',
      at: 5,
    });
  });
});

describe('채널 이름', () => {
  it('앱 전용 이름을 쓴다', () => {
    expect(SESSION_CHANNEL_NAME).toBe('gf.auth.session');
    expect(SESSION_SIGNAL_STORAGE_KEY).toBe('gf.auth.signal');
  });
});
