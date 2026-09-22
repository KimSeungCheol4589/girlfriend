import { inputSignature, newRequestId } from '@/features/auth/request-id';

/**
 * 논리적인 한 요청의 멱등성 키(`requestId`) 관리.
 *
 * CONTRACTS.md 7-1 규칙
 *   - 같은 입력을 **다시 시도**하면 같은 키를 쓴다. 응답을 잃어버린 재전송이 한 번만 반영된다.
 *   - 입력을 **실제로 고치면** 새 키를 쓴다. 같은 키에 다른 입력이면 DB가 CONFLICT로 거부한다.
 *   - **확정 응답**(성공·검증 실패·충돌 등)을 받은 뒤의 제출은 새 키를 쓴다. 그래야 사용자가
 *     의도적으로 같은 작업을 다시 할 수 있다(AUTH-001 독립 검토 지적 1과 같은 이유).
 *
 * 키는 제출하는 순간 동기적으로 계산한다. useEffect로 늦게 만들면 첫 클릭에 빈 키가 나간다.
 */
export type RequestKeyTracker = {
  /** 이 입력으로 보낼 키. 직전 시도와 입력이 같고 아직 확정되지 않았으면 같은 키를 돌려준다. */
  keyFor: (values: Record<string, unknown>) => string;
  /** 서버 응답을 받은 뒤 호출한다. `definitive`면 다음 제출은 새 키를 쓴다. */
  settle: (definitive: boolean) => void;
};

export function createRequestKeyTracker(generate: () => string = newRequestId): RequestKeyTracker {
  let current: { signature: string; requestId: string; settled: boolean } | null = null;

  return {
    keyFor(values) {
      const signature = inputSignature(values);
      if (current && !current.settled && current.signature === signature) {
        return current.requestId;
      }
      current = { signature, requestId: generate(), settled: false };
      return current.requestId;
    },
    settle(definitive) {
      if (current && definitive) current.settled = true;
    },
  };
}
