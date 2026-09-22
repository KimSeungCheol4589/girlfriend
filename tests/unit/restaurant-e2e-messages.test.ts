import { describe, expect, it } from 'vitest';

import { CONFIRMED_ACTION_STALE_MESSAGE as PRODUCT_CONFIRMED_STALE, mapRestaurantRpcError } from '@/features/restaurants/errors';
import { visitedDateProblem } from '@/features/restaurants/schema';

import {
  CONFIRMED_ACTION_STALE_MESSAGE,
  FUTURE_VISIT_MESSAGE,
  STALE_EDIT_MESSAGE,
} from '../restaurants/e2e/messages';

/**
 * E2E 스펙이 찾는 문구가 제품 출력과 정확히 같은지 고정한다.
 * (1차 E2E에서 문구 변경 후 스펙 문자열이 어긋나 실패했다.)
 */
describe('E2E 문구 = 제품 문구', () => {
  it('정보 수정 버전 충돌', () => {
    expect(mapRestaurantRpcError({ code: 'GF409', details: '{"expectedVersion":"stale"}' }).message).toBe(
      STALE_EDIT_MESSAGE,
    );
  });

  it('확인형 작업 버전 충돌', () => {
    expect(PRODUCT_CONFIRMED_STALE).toBe(CONFIRMED_ACTION_STALE_MESSAGE);
  });

  it('미래 방문일', () => {
    expect(visitedDateProblem('2999-01-01', '2026-09-21')).toBe(FUTURE_VISIT_MESSAGE);
  });
});
