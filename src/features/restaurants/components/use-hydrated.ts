'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/**
 * 하이드레이션이 끝났는지. 서버 렌더와 하이드레이션 중에는 false, 그 뒤에는 true.
 *
 * 왜 필요한가(FOOD-001 1차 E2E 분석):
 *   - 서버가 그린 버튼을 하이드레이션 전에 누르면 `type="button"`은 아무 일도 하지 않는다(입력이 조용히 사라진다).
 *   - `onSubmit`으로 처리하는 폼의 제출 버튼을 하이드레이션 전에 누르면 브라우저 기본 제출(GET)이 일어나
 *     이름·메모 같은 입력값이 주소 쿼리로 나간다.
 * 그래서 변경 폼·버튼은 이 값이 true가 될 때까지 비활성화한다. 비활성 제출 버튼이면 Enter 암묵 제출도 일어나지 않는다.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
