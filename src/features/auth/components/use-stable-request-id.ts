'use client';

import { useEffect, useState } from 'react';

import { inputSignature, newRequestId, nextRequestIdState, type RequestIdState } from '../request-id';

import type { AuthFormState } from '../form-state';

/**
 * 같은 입력으로 재시도하면 같은 요청 키를 유지하고, 입력을 실제로 고치면 새 키를 만든다.
 * (CONTRACTS.md 7-1)
 *
 * 키는 브라우저에서만 만든다. 서버 렌더 결과에 값을 넣으면 hydration이 어긋나고,
 * 서버가 만든 키는 재시도마다 달라져 멱등성이 깨진다.
 * 자바스크립트가 없어 값이 비면 Server Action이 그 요청에 한해 새 키를 만든다.
 */
export function useStableRequestId(values: Record<string, unknown>): string {
  const signature = inputSignature(values);
  const [state, setState] = useState<RequestIdState | null>(null);

  useEffect(() => {
    setState((previous) => nextRequestIdState(previous, signature, newRequestId));
  }, [signature]);

  return state?.requestId ?? '';
}

/**
 * 서버가 **확정 응답**을 준 뒤에는 키를 새로 뽑는다.
 *
 * 왜 필요한가: 같은 입력이면 키를 유지한다는 규칙만 있으면, 한 번 성공한 요청과 **같은 입력**을
 * 다시 보낼 방법이 없다. DB가 이전 결과를 그대로 재생하기 때문이다(멱등성).
 * 초대가 특히 문제였다. 같은 주소로 초대를 만든 뒤 화면을 새로 고치지 않고 다시 만들면
 * 재생 응답(`tokenIssued: false`)만 돌아와 "새로 만들어 주세요"라는 안내가 지시하는 행동 자체가
 * 막혔다(독립 검토 지적 1).
 *
 * 규칙:
 *   - 응답을 못 받은 재시도(네트워크 실패 등)는 **같은 키**를 유지한다. 중복 반영을 막아야 한다.
 *   - 확정 응답(성공, 또는 재시도해도 결과가 달라지지 않는 실패)을 받으면 **새 키**를 만든다.
 *     그래야 사용자가 같은 입력으로 새 작업을 의도적으로 다시 할 수 있다.
 */
export function isDefinitiveResponse(state: AuthFormState): boolean {
  if (state.status === 'idle') return false;
  if (state.status === 'success') return true;
  // 재시도 가능·원인 불명은 "서버가 처리했는지 알 수 없음"으로 보고 키를 유지한다.
  return state.code !== 'RETRYABLE_ERROR' && state.code !== 'UNKNOWN';
}

export function useSettledRequestId(
  values: Record<string, unknown>,
  state: AuthFormState,
): string {
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (isDefinitiveResponse(state)) setAttempt((previous) => previous + 1);
  }, [state]);

  return useStableRequestId({ ...values, attempt });
}
