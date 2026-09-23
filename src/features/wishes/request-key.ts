import { inputSignature, newRequestId } from '@/features/auth/request-id';

/**
 * 변경 요청 키(requestId) 수명 규칙 — 순수 함수.
 *
 * CONTRACTS.md 7-1: 같은 요청을 다시 보낼 때는 **같은 키·같은 입력**을 쓴다.
 *   - 응답을 못 받았거나(네트워크) 재시도 가능·원인 불명 실패 → 서버가 처리했는지 모른다.
 *     같은 입력이면 같은 키를 유지해 DB가 이전 결과를 재생하게 한다(중복 생성 방지).
 *   - 확정 응답(성공·입력 오류·충돌·없음) → 키를 버린다. 다음 제출은 새 작업이므로 새 키를 쓴다.
 *   - 입력을 바꾸면 다른 작업이다. 같은 키로 다른 입력을 보내면 DB가 CONFLICT로 거부하므로 새 키를 쓴다.
 */

export type RequestKeyState = {
  requestId: string;
  signature: string;
} | null;

export function signatureOf(operation: string, payload: Record<string, unknown>): string {
  return inputSignature({ operation, payload });
}

/** 보낼 키를 고른다. 이전 키가 같은 입력으로 "미확정" 상태면 그 키를 다시 쓴다. */
export function acquireRequestKey(
  state: RequestKeyState,
  signature: string,
  generate: () => string = newRequestId,
): NonNullable<RequestKeyState> {
  if (state && state.signature === signature) return state;
  return { requestId: generate(), signature };
}

/** 응답을 받은 뒤 다음 상태. 확정이면 키를 버리고, 불확실하면 그대로 둔다. */
export function settleRequestKey(state: RequestKeyState, definitive: boolean): RequestKeyState {
  return definitive ? null : state;
}

// ---------------------------------------------------------------------------
// 실행 관문: 처리 중·성공 후 잠금을 **동기적으로** 판단한다(React 상태 반영을 기다리지 않는다)
// ---------------------------------------------------------------------------

export type MutationGate = {
  key: RequestKeyState;
  /** 요청을 보내고 응답을 기다리는 중. */
  running: boolean;
  /** 성공 후 이 화면에서 더는 실행하지 않는다(성공 뒤 다른 화면으로 이동하는 작업). */
  locked: boolean;
};

export const OPEN_GATE: MutationGate = { key: null, running: false, locked: false };

/**
 * 실행을 시작할 수 있으면 다음 관문과 보낼 키를, 없으면 null을 돌려준다.
 * 처리 중이거나 잠겼으면 null — 빠른 두 번째 클릭은 여기서 버려진다.
 */
export function beginMutation(
  gate: MutationGate,
  signature: string,
  generate: () => string = newRequestId,
): { gate: MutationGate; requestId: string } | null {
  if (gate.running || gate.locked) return null;
  const key = acquireRequestKey(gate.key, signature, generate);
  return { gate: { key, running: true, locked: false }, requestId: key.requestId };
}

/**
 * 응답 뒤 관문.
 *
 * - `lockOnSuccess`(성공하면 다른 화면으로 이동하는 작업: 위시 등록·수정, 위시 삭제):
 *   성공하면 **잠그고 키도 버리지 않는다.** 이동이 끝나기 전에 도착한 클릭이 새 키로 새 작업(= 중복 생성)을
 *   만들지 못하게 한다. 새 등록은 새 화면(새 컴포넌트)에서 시작한다.
 * - 그 밖의 성공·확정 실패: 키를 버린다(같은 입력으로도 새 작업을 할 수 있다).
 * - 불확실한 실패: 키를 유지한다(같은 입력 재시도 = 같은 키).
 */
export function finishMutation(
  gate: MutationGate,
  outcome: { ok: boolean; definitive: boolean },
  lockOnSuccess: boolean,
): MutationGate {
  if (outcome.ok && lockOnSuccess) return { key: gate.key, running: false, locked: true };
  return { key: settleRequestKey(gate.key, outcome.ok || outcome.definitive), running: false, locked: false };
}
