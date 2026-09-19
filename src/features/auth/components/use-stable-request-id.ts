'use client';

import { useEffect, useState } from 'react';

import { inputSignature, newRequestId, nextRequestIdState, type RequestIdState } from '../request-id';

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
