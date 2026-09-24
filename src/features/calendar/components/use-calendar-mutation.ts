'use client';

import { useCallback, useRef, useState } from 'react';

import { isDefinitiveCode, type CalendarFailure } from '../errors';
import {
  beginMutation,
  finishMutation,
  OPEN_GATE,
  signatureOf,
  type MutationGate,
} from '../request-key';

import type { CalendarActionResult } from '../actions';

/** Server Action 호출 자체가 실패한 경우(응답 없음). 저장 여부를 단정하지 않는다. */
export const NETWORK_FAILURE: CalendarFailure = {
  ok: false,
  code: 'UNKNOWN',
  message:
    '서버 응답을 받지 못해 저장됐는지 확인하지 못했어요. 입력을 바꾸지 말고 같은 내용으로 다시 시도하면 중복 없이 처리돼요.',
};

/**
 * 변경 요청 실행기.
 *
 * - 요청 키 수명은 `request-key.ts`의 규칙을 따른다: 불확실한 실패 뒤 같은 입력이면 같은 키,
 *   확정 응답 뒤나 입력이 바뀌면 새 키.
 * - 처리 중에는 다시 실행하지 않는다(중복 클릭). 판단은 ref에 든 관문으로 **동기적으로** 한다.
 * - `lockOnSuccess`: 성공 뒤 다른 화면으로 이동하는 작업은 성공하면 잠근다. 이동이 끝나기 전에 도착한
 *   클릭이 새 키로 두 번째 생성을 만들지 못하게 한다. `locked`로 화면을 비활성 상태로 유지한다.
 * - DB의 requestId가 두 번째 방어선이다.
 */
export function useCalendarMutation<TPayload extends Record<string, unknown>, TData>(
  operation: string,
  action: (input: TPayload & { requestId: string }) => Promise<CalendarActionResult<TData>>,
  options: { lockOnSuccess?: boolean } = {},
) {
  const lockOnSuccess = options.lockOnSuccess ?? false;
  const gateRef = useRef<MutationGate>(OPEN_GATE);
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);

  const run = useCallback(
    async (payload: TPayload): Promise<CalendarActionResult<TData> | null> => {
      const started = beginMutation(gateRef.current, signatureOf(operation, payload));
      if (!started) return null;
      gateRef.current = started.gate;
      setPending(true);

      let result: CalendarActionResult<TData>;
      try {
        result = await action({ ...payload, requestId: started.requestId });
      } catch {
        result = NETWORK_FAILURE;
      }

      gateRef.current = finishMutation(
        gateRef.current,
        { ok: result.ok, definitive: result.ok || isDefinitiveCode(result.code) },
        lockOnSuccess,
      );
      setLocked(gateRef.current.locked);
      setPending(false);
      return result;
    },
    [action, operation, lockOnSuccess],
  );

  return { run, pending, locked };
}
