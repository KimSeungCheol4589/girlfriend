import { describe, expect, it } from 'vitest';

import { createRequestKeyTracker } from '@/features/memories/live/request-key';

function counterGenerator() {
  let count = 0;
  return () => {
    count += 1;
    return `key-${count}`;
  };
}

const input = { title: '한강', tags: ['산책'], photoAssetIds: ['a', 'b'], expectedVersion: 1 };

describe('createRequestKeyTracker', () => {
  it('응답을 모르는 재시도는 같은 키를 쓴다', () => {
    const tracker = createRequestKeyTracker(counterGenerator());
    const first = tracker.keyFor(input);
    tracker.settle(false); // 네트워크 실패·재시도 가능
    expect(tracker.keyFor({ ...input })).toBe(first);
  });

  it('키 순서가 달라도 같은 입력이면 같은 키', () => {
    const tracker = createRequestKeyTracker(counterGenerator());
    const first = tracker.keyFor(input);
    expect(tracker.keyFor({ expectedVersion: 1, photoAssetIds: ['a', 'b'], tags: ['산책'], title: '한강' })).toBe(first);
  });

  it('입력을 고치면 새 키', () => {
    const tracker = createRequestKeyTracker(counterGenerator());
    const first = tracker.keyFor(input);
    expect(tracker.keyFor({ ...input, title: '한강 산책' })).not.toBe(first);
  });

  it('사진 순서가 바뀌면 새 키', () => {
    const tracker = createRequestKeyTracker(counterGenerator());
    const first = tracker.keyFor(input);
    expect(tracker.keyFor({ ...input, photoAssetIds: ['b', 'a'] })).not.toBe(first);
  });

  it('확정 응답 뒤에는 같은 입력이라도 새 키', () => {
    const tracker = createRequestKeyTracker(counterGenerator());
    const first = tracker.keyFor(input);
    tracker.settle(true);
    expect(tracker.keyFor(input)).not.toBe(first);
  });
});
