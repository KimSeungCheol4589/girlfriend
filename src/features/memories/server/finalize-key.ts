import { createHash } from 'node:crypto';

/**
 * 업로드 확정 요청의 멱등성 키.
 *
 * 한 asset의 확정은 논리적으로 한 번뿐이므로 서버가 asset ID에서 결정적으로 만든다.
 * 클라이언트가 보낸 값을 쓰지 않는다. 결과는 UUID v4 모양(버전·변형 비트 고정)이다.
 * 멱등성 기록의 주인은 `p_uploader_id`라 다른 사용자와 키가 겹쳐도 섞이지 않는다.
 */
export function finalizeRequestId(assetId: string): string {
  const digest = createHash('sha256').update(`memories.finalize:${assetId.toLowerCase()}`).digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
