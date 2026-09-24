import { describe, expect, it } from 'vitest';

import {
  acquireRequestKey,
  beginMutation,
  finishMutation,
  OPEN_GATE,
  settleRequestKey,
  signatureOf,
} from '@/features/calendar/request-key';

/**
 * 요청 키 수명(CONTRACTS.md 7-1).
 *
 *   - 같은 입력의 불확실한 실패 재시도 → 같은 키(DB가 이전 결과를 재생한다).
 *   - 확정 응답 뒤 → 새 키.
 *   - 입력이 바뀌면 → 새 키(같은 키에 다른 입력은 DB가 CONFLICT로 거부한다).
 */

let counter = 0;
const generate = () => `key-${(counter += 1)}`;

function reset() {
  counter = 0;
}

describe('signatureOf', () => {
  it('키 순서에 흔들리지 않는다', () => {
    expect(signatureOf('saveCalendarEvent', { a: 1, b: 2 })).toBe(
      signatureOf('saveCalendarEvent', { b: 2, a: 1 }),
    );
  });

  it('작업이 다르면 다른 서명이다', () => {
    expect(signatureOf('saveCalendarEvent', { a: 1 })).not.toBe(
      signatureOf('deleteCalendarEvent', { a: 1 }),
    );
  });

  it('시각 입력이 바뀌면 다른 서명이다', () => {
    expect(signatureOf('saveCalendarEvent', { startTime: '11:00' })).not.toBe(
      signatureOf('saveCalendarEvent', { startTime: '12:00' }),
    );
  });
});

describe('acquireRequestKey / settleRequestKey', () => {
  it('같은 입력이면 키를 유지하고 다른 입력이면 새로 만든다', () => {
    reset();
    const first = acquireRequestKey(null, 'sig-a', generate);
    expect(acquireRequestKey(first, 'sig-a', generate)).toBe(first);
    expect(acquireRequestKey(first, 'sig-b', generate).requestId).toBe('key-2');
  });

  it('확정 응답 뒤에는 키를 버린다', () => {
    reset();
    const state = acquireRequestKey(null, 'sig-a', generate);
    expect(settleRequestKey(state, true)).toBeNull();
    expect(settleRequestKey(state, false)).toBe(state);
  });
});

describe('beginMutation', () => {
  it('처리 중이면 시작하지 않는다(중복 클릭)', () => {
    reset();
    const started = beginMutation(OPEN_GATE, 'sig-a', generate);
    expect(started).not.toBeNull();
    expect(beginMutation(started!.gate, 'sig-a', generate)).toBeNull();
  });

  it('성공 후 잠긴 화면에서는 시작하지 않는다', () => {
    reset();
    const started = beginMutation(OPEN_GATE, 'sig-a', generate)!;
    const locked = finishMutation(started.gate, { ok: true, definitive: true }, true);
    expect(beginMutation(locked, 'sig-a', generate)).toBeNull();
    expect(beginMutation(locked, 'sig-b', generate)).toBeNull();
  });
});

describe('finishMutation', () => {
  it('불확실한 실패 뒤 같은 입력 재시도는 같은 키를 쓴다', () => {
    reset();
    const first = beginMutation(OPEN_GATE, 'sig-a', generate)!;
    expect(first.requestId).toBe('key-1');

    const afterFailure = finishMutation(first.gate, { ok: false, definitive: false }, false);
    const retry = beginMutation(afterFailure, 'sig-a', generate)!;
    expect(retry.requestId).toBe('key-1');
  });

  it('확정 실패 뒤 다시 보낼 때는 새 키를 쓴다', () => {
    reset();
    const first = beginMutation(OPEN_GATE, 'sig-a', generate)!;
    const afterConflict = finishMutation(first.gate, { ok: false, definitive: true }, false);
    expect(beginMutation(afterConflict, 'sig-a', generate)!.requestId).toBe('key-2');
  });

  it('입력을 고쳐 다시 보내면 새 키를 쓴다', () => {
    reset();
    const first = beginMutation(OPEN_GATE, 'sig-a', generate)!;
    const afterFailure = finishMutation(first.gate, { ok: false, definitive: false }, false);
    expect(beginMutation(afterFailure, 'sig-b', generate)!.requestId).toBe('key-2');
  });

  it('이동하지 않는 작업(상태 바꾸기)은 성공해도 잠기지 않는다', () => {
    reset();
    const first = beginMutation(OPEN_GATE, 'sig-a', generate)!;
    const after = finishMutation(first.gate, { ok: true, definitive: true }, false);
    expect(after.locked).toBe(false);
    expect(beginMutation(after, 'sig-a', generate)!.requestId).toBe('key-2');
  });
});
