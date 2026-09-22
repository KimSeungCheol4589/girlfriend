import { describe, expect, it } from 'vitest';

import { readBoundedBody } from '@/features/memories/server/bounded-read';
import { finalizeRequestId } from '@/features/memories/server/finalize-key';

const ASSET_1 = '11111111-1111-4111-8111-111111111111';
const ASSET_2 = '22222222-2222-4222-8222-222222222222';

function stream(chunks: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size).fill(1));
      controller.close();
    },
  });
}

describe('finalizeRequestId — asset당 하나의 결정적 키', () => {
  it('같은 asset이면 같은 키, 대소문자 무시', () => {
    expect(finalizeRequestId(ASSET_1)).toBe(finalizeRequestId(ASSET_1.toUpperCase()));
  });

  it('다른 asset이면 다른 키', () => {
    expect(finalizeRequestId(ASSET_1)).not.toBe(finalizeRequestId(ASSET_2));
  });

  it('UUID v4 모양', () => {
    expect(finalizeRequestId(ASSET_1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('readBoundedBody — 상한을 넘는 순간 읽기를 멈춘다', () => {
  it('상한 이하이면 전체를 돌려준다', async () => {
    const result = await readBoundedBody(stream([3, 4]), 10);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes.byteLength).toBe(7);
  });

  it('정확히 상한이면 허용', async () => {
    const result = await readBoundedBody(stream([5, 5]), 10);
    expect(result.ok).toBe(true);
  });

  it('스트림이 상한을 넘으면 거부', async () => {
    expect(await readBoundedBody(stream([6, 6]), 10)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('Content-Length가 상한을 넘으면 읽지 않고 거부', async () => {
    expect(await readBoundedBody(stream([1]), 10, '11')).toEqual({ ok: false, reason: 'too_large' });
  });

  it('빈 본문은 거부', async () => {
    expect(await readBoundedBody(stream([]), 10)).toEqual({ ok: false, reason: 'empty' });
    expect(await readBoundedBody(null, 10)).toEqual({ ok: false, reason: 'empty' });
  });
});
