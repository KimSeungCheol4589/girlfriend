import { describe, expect, it } from 'vitest';

import {
  inputSignature,
  isRequestId,
  newRequestId,
  nextRequestIdState,
} from '@/features/auth/request-id';

function counter() {
  let index = 0;
  return () => `key-${(index += 1)}`;
}

describe('inputSignature', () => {
  it('키 순서가 달라도 같은 서명을 만든다', () => {
    expect(inputSignature({ a: '1', b: '2' })).toBe(inputSignature({ b: '2', a: '1' }));
  });

  it('값이 바뀌면 서명이 달라진다', () => {
    expect(inputSignature({ a: '1' })).not.toBe(inputSignature({ a: '2' }));
  });

  it('null과 undefined를 같게 다룬다', () => {
    expect(inputSignature({ a: null })).toBe(inputSignature({ a: undefined }));
  });

  it('중첩 객체와 배열도 안정적으로 비교한다', () => {
    expect(inputSignature({ a: { x: 1, y: 2 } })).toBe(inputSignature({ a: { y: 2, x: 1 } }));
    expect(inputSignature({ a: [1, 2] })).not.toBe(inputSignature({ a: [2, 1] }));
  });
});

describe('nextRequestIdState', () => {
  it('같은 입력으로 재시도하면 같은 키를 유지한다', () => {
    const generate = counter();
    const signature = inputSignature({ name: '우리 공간' });

    const first = nextRequestIdState(null, signature, generate);
    const retry = nextRequestIdState(first, signature, generate);

    expect(retry).toBe(first);
    expect(retry.requestId).toBe('key-1');
  });

  it('입력을 실제로 고치면 새 키를 만든다', () => {
    const generate = counter();
    const first = nextRequestIdState(null, inputSignature({ name: 'A' }), generate);
    const edited = nextRequestIdState(first, inputSignature({ name: 'B' }), generate);

    expect(edited.requestId).toBe('key-2');
    expect(edited.requestId).not.toBe(first.requestId);
  });

  it('고쳤다가 되돌리면 또 새 키가 된다(같은 키에 다른 입력을 보내지 않기 위해)', () => {
    const generate = counter();
    const a = nextRequestIdState(null, inputSignature({ name: 'A' }), generate);
    const b = nextRequestIdState(a, inputSignature({ name: 'B' }), generate);
    const backToA = nextRequestIdState(b, inputSignature({ name: 'A' }), generate);

    expect(backToA.requestId).toBe('key-3');
  });
});

describe('newRequestId', () => {
  it('UUID 형식을 만든다', () => {
    const id = newRequestId();
    expect(isRequestId(id)).toBe(true);
  });

  it('매번 다른 값을 만든다', () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });

  it('형식이 아닌 값은 거부한다', () => {
    expect(isRequestId('')).toBe(false);
    expect(isRequestId('not-a-uuid')).toBe(false);
    expect(isRequestId(undefined)).toBe(false);
    expect(isRequestId(123)).toBe(false);
  });
});
