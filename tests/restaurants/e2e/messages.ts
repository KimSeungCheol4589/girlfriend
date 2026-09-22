/**
 * E2E가 화면에서 찾는 제품 문구.
 *
 * 스펙은 `@/` 경로 별칭을 쓰는 제품 모듈을 직접 불러오지 않는다(Playwright의 tsconfig 경로 처리에 기대지 않기 위해).
 * 대신 `tests/unit/restaurant-e2e-messages.test.ts`가 이 값이 제품 오류 매핑의 실제 출력과 **정확히 같은지** 고정한다.
 * 1차 E2E 실패 원인: 충돌 문구를 바꾼 뒤 스펙의 고정 문자열을 갱신하지 않았다.
 */

/** 정보 수정 버전 충돌(`GF409 {"expectedVersion":"stale"}`) 문구. */
export const STALE_EDIT_MESSAGE =
  '상대방이 먼저 바꾼 내용(정보·방문 상태·후기)이 있어 저장하지 않았어요. 입력한 내용은 그대로 두었으니 최신 내용을 확인한 뒤 다시 저장해 주세요.';

/** 확인형 작업(방문 취소·삭제)의 버전 충돌 문구. */
export const CONFIRMED_ACTION_STALE_MESSAGE =
  '확인한 뒤에 맛집 정보나 후기가 바뀌어 아무것도 바꾸지 않았어요. 최신 내용을 불러왔으니 함께 지워질 후기를 다시 확인해 주세요.';

/** 미래 방문일 검증 문구. */
export const FUTURE_VISIT_MESSAGE = '방문일은 오늘보다 뒤일 수 없어요.';
