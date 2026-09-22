/**
 * 크기 상한이 있는 본문 읽기.
 *
 * 업로드 확정기는 사용자가 올린 파일을 서버 메모리로 읽는다. 버킷의 크기 제한을 믿더라도
 * 서버는 상한을 넘는 순간 읽기를 멈춘다(DESIGN.md 8.2: 실제 크기 검사).
 */
export type BoundedReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'too_large' | 'empty' | 'read_failed' };

export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  declaredLength?: string | null,
): Promise<BoundedReadResult> {
  if (declaredLength) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > maxBytes) {
      await body?.cancel().catch(() => undefined);
      return { ok: false, reason: 'too_large' };
    }
  }
  if (!body) return { ok: false, reason: 'empty' };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'read_failed' };
  }

  if (total === 0) return { ok: false, reason: 'empty' };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}
