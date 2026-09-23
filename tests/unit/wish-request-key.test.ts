import { describe, expect, it } from 'vitest';

import {
  acquireRequestKey,
  beginMutation,
  finishMutation,
  OPEN_GATE,
  settleRequestKey,
  signatureOf,
} from '@/features/wishes/request-key';

/**
 * 요청 키(requestId) 수명 규칙 단위 테스트.
 *
 * CONTRACTS.md 7-1
 *   - 불확실한 실패 뒤 **같은 입력**이면 같은 키를 유지한다(중복 생성 방지).
 *   - 확정 응답 뒤나 입력이 바뀌면 새 키를 쓴다(같은 키에 다른 입력은 DB가 거부한다).
 */

function counter() {
  let n = 0;
  return () => `req-${++n}`;
}

describe('signatureOf', () => {
  it('키 순서가 달라도 같은 입력이면 같은 서명이다', () => {
    expect(signatureOf('saveWish', { title: 'a', memo: 'b' })).toBe(
      signatureOf('saveWish', { memo: 'b', title: 'a' }),
    );
  });

  it('작업 이름이 다르면 다른 서명이다', () => {
    expect(signatureOf('saveWish', { id: 1 })).not.toBe(signatureOf('deleteWish', { id: 1 }));
  });

  it('값이 바뀌면 다른 서명이다', () => {
    expect(signatureOf('saveWish', { title: 'a' })).not.toBe(signatureOf('saveWish', { title: 'b' }));
    // null과 undefined는 같은 "값 없음"으로 본다.
    expect(signatureOf('saveWish', { d: null })).toBe(signatureOf('saveWish', { d: undefined }));
  });
});

describe('acquireRequestKey', () => {
  it('같은 서명이면 이전 키를 그대로 쓴다', () => {
    const generate = counter();
    const first = acquireRequestKey(null, 'sig', generate);
    expect(acquireRequestKey(first, 'sig', generate)).toBe(first);
  });

  it('서명이 바뀌면 새 키를 만든다', () => {
    const generate = counter();
    const first = acquireRequestKey(null, 'sig-a', generate);
    const second = acquireRequestKey(first, 'sig-b', generate);
    expect(second.requestId).not.toBe(first.requestId);
  });
});

describe('settleRequestKey', () => {
  it('확정 응답이면 키를 버리고 불확실하면 유지한다', () => {
    const state = { requestId: 'req-1', signature: 'sig' };
    expect(settleRequestKey(state, true)).toBeNull();
    expect(settleRequestKey(state, false)).toBe(state);
  });
});

describe('beginMutation / finishMutation', () => {
  it('처리 중에는 두 번째 실행을 막는다(빠른 중복 클릭)', () => {
    const generate = counter();
    const started = beginMutation(OPEN_GATE, 'sig', generate);
    expect(started).not.toBeNull();
    expect(beginMutation(started!.gate, 'sig', generate)).toBeNull();
  });

  it('불확실한 실패 뒤 같은 입력은 같은 키로 재시도한다', () => {
    const generate = counter();
    const first = beginMutation(OPEN_GATE, 'sig', generate)!;
    const afterFail = finishMutation(first.gate, { ok: false, definitive: false }, false);
    const retry = beginMutation(afterFail, 'sig', generate)!;
    expect(retry.requestId).toBe(first.requestId);
  });

  it('확정 실패 뒤 같은 입력은 새 키를 쓴다', () => {
    const generate = counter();
    const first = beginMutation(OPEN_GATE, 'sig', generate)!;
    const afterConflict = finishMutation(first.gate, { ok: false, definitive: true }, false);
    const retry = beginMutation(afterConflict, 'sig', generate)!;
    expect(retry.requestId).not.toBe(first.requestId);
  });

  it('불확실한 실패 뒤 입력을 고치면 새 키를 쓴다', () => {
    const generate = counter();
    const first = beginMutation(OPEN_GATE, 'sig-a', generate)!;
    const afterFail = finishMutation(first.gate, { ok: false, definitive: false }, false);
    const changed = beginMutation(afterFail, 'sig-b', generate)!;
    expect(changed.requestId).not.toBe(first.requestId);
  });

  it('성공 후 화면을 옮기는 작업은 잠겨 두 번째 요청을 만들지 않는다', () => {
    const generate = counter();
    const first = beginMutation(OPEN_GATE, 'sig', generate)!;
    const afterSuccess = finishMutation(first.gate, { ok: true, definitive: true }, true);
    expect(afterSuccess.locked).toBe(true);
    // 이동이 끝나기 전 도착한 클릭은 새 키로 새 작업을 만들지 못한다.
    expect(beginMutation(afterSuccess, 'sig', generate)).toBeNull();
    expect(beginMutation(afterSuccess, 'sig-other', generate)).toBeNull();
  });

  it('그 자리에 머무르는 작업은 성공해도 잠기지 않고 새 키로 다음 작업을 한다', () => {
    const generate = counter();
    const first = beginMutation(OPEN_GATE, 'sig', generate)!;
    const afterSuccess = finishMutation(first.gate, { ok: true, definitive: true }, false);
    expect(afterSuccess.locked).toBe(false);
    const next = beginMutation(afterSuccess, 'sig', generate)!;
    expect(next.requestId).not.toBe(first.requestId);
  });
});
