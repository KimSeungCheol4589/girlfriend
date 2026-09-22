import { describe, expect, it } from 'vitest';

import {
  acquireRequestKey,
  beginMutation,
  finishMutation,
  OPEN_GATE,
  settleRequestKey,
  signatureOf,
} from '@/features/restaurants/request-key';

describe('실행 관문 — 빠른 두 번 클릭(E2E v2 중복 생성 회귀)', () => {
  const signature = signatureOf('saveRestaurant', { restaurantId: null, name: '두번클릭', expectedVersion: 0 });

  it('처리 중에는 두 번째 실행을 동기적으로 거부한다', () => {
    const first = beginMutation(OPEN_GATE, signature, counter());
    expect(first).not.toBeNull();
    expect(beginMutation(first!.gate, signature, counter())).toBeNull();
  });

  it('이동하는 작업은 성공 뒤 잠겨, 이동 전에 도착한 클릭이 새 키로 두 번째 생성을 만들지 못한다', () => {
    const generate = counter();
    const first = beginMutation(OPEN_GATE, signature, generate)!;
    const afterSuccess = finishMutation(first.gate, { ok: true, definitive: true }, true);

    expect(afterSuccess.locked).toBe(true);
    expect(beginMutation(afterSuccess, signature, generate)).toBeNull();
    // 키도 버리지 않는다(잠금이 풀리는 경로가 생겨도 같은 입력은 같은 키 → DB 재생).
    expect(afterSuccess.key?.requestId).toBe(first.requestId);
  });

  it('잠그지 않는 작업(후기 등)은 성공 뒤 같은 입력도 새 작업으로 시작한다', () => {
    const generate = counter();
    const first = beginMutation(OPEN_GATE, signature, generate)!;
    const afterSuccess = finishMutation(first.gate, { ok: true, definitive: true }, false);
    const next = beginMutation(afterSuccess, signature, generate);
    expect(next).not.toBeNull();
    expect(next!.requestId).not.toBe(first.requestId);
  });

  it('불확실한 실패 뒤에는 잠그지 않고 같은 입력이면 같은 키로 다시 보낸다(응답 유실 재시도)', () => {
    const generate = counter();
    const first = beginMutation(OPEN_GATE, signature, generate)!;
    const afterLost = finishMutation(first.gate, { ok: false, definitive: false }, true);
    expect(afterLost.locked).toBe(false);
    const retry = beginMutation(afterLost, signature, generate);
    expect(retry!.requestId).toBe(first.requestId);
  });

  it('확정 실패(충돌·입력 오류) 뒤에는 잠그지 않고 새 키를 쓴다', () => {
    const generate = counter();
    const first = beginMutation(OPEN_GATE, signature, generate)!;
    const afterConflict = finishMutation(first.gate, { ok: false, definitive: true }, true);
    expect(afterConflict.locked).toBe(false);
    expect(beginMutation(afterConflict, signature, generate)!.requestId).not.toBe(first.requestId);
  });
});

function counter() {
  let n = 0;
  return () => `key-${(n += 1)}`;
}

describe('요청 키 수명', () => {
  const payload = { restaurantId: null, name: '성수 파스타', expectedVersion: 0 };

  it('불확실한 실패 뒤 같은 입력으로 다시 보내면 같은 키를 쓴다', () => {
    const generate = counter();
    const signature = signatureOf('saveRestaurant', payload);

    const first = acquireRequestKey(null, signature, generate);
    const afterUncertain = settleRequestKey(first, false);
    const retry = acquireRequestKey(afterUncertain, signatureOf('saveRestaurant', { ...payload }), generate);

    expect(retry.requestId).toBe(first.requestId);
  });

  it('확정 응답 뒤에는 같은 입력이라도 새 키를 쓴다(새 작업)', () => {
    const generate = counter();
    const signature = signatureOf('saveRestaurant', payload);

    const first = acquireRequestKey(null, signature, generate);
    const afterSuccess = settleRequestKey(first, true);
    const next = acquireRequestKey(afterSuccess, signature, generate);

    expect(afterSuccess).toBeNull();
    expect(next.requestId).not.toBe(first.requestId);
  });

  it('불확실한 실패 뒤 입력을 바꾸면 새 키를 쓴다(같은 키에 다른 입력은 DB가 거부한다)', () => {
    const generate = counter();
    const first = acquireRequestKey(null, signatureOf('saveRestaurant', payload), generate);
    const kept = settleRequestKey(first, false);
    const changed = acquireRequestKey(kept, signatureOf('saveRestaurant', { ...payload, name: '다른 이름' }), generate);

    expect(changed.requestId).not.toBe(first.requestId);
  });

  it('작업 이름이 다르면 같은 입력이라도 다른 서명이다', () => {
    expect(signatureOf('deleteReview', { id: 'x' })).not.toBe(signatureOf('saveReview', { id: 'x' }));
  });

  it('입력 키 순서는 서명에 영향을 주지 않는다', () => {
    expect(signatureOf('op', { a: 1, b: 'x' })).toBe(signatureOf('op', { b: 'x', a: 1 }));
  });
});
