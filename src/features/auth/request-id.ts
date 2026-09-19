/**
 * 변경 요청의 멱등성 키(`requestId`).
 *
 * 계약(CONTRACTS.md 7-1): 모든 변경 RPC에 requestId를 보내고,
 * **같은 입력으로 다시 시도하면 같은 값을 유지**한다. 그래야 응답을 잃어버린 재전송이
 * 한 번만 반영된다. 반대로 사용자가 입력을 실제로 고쳤다면 **새 키**를 써야 한다.
 * 같은 키로 다른 입력을 보내면 DB가 `CONFLICT`로 거부하기 때문이다.
 */

export type RequestIdState = {
  requestId: string;
  /** 이 키를 발급할 때의 입력 서명. */
  signature: string;
};

/** 키 순서에 흔들리지 않는 입력 서명. 값은 그대로 두되 비교에만 쓴다. */
export function inputSignature(values: Record<string, unknown>): string {
  const entries = Object.entries(values)
    .map(([key, value]) => [key, normalize(value)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify(entries);
}

function normalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => [key, normalize(inner)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  return String(value);
}

/**
 * 입력이 그대로면 이전 키를 유지하고, 달라졌으면 새 키를 만든다.
 * 실패 후 재시도는 입력이 같으므로 같은 키가 유지된다.
 */
export function nextRequestIdState(
  previous: RequestIdState | null,
  signature: string,
  generate: () => string,
): RequestIdState {
  if (previous && previous.signature === signature) return previous;
  return { requestId: generate(), signature };
}

export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 아주 오래된 런타임 대비. UUID v4 형식만 맞춘다.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
