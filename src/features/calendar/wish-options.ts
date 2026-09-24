import type { WishOption } from './types';

/**
 * 수정 화면의 위시 선택지 — 순수 함수.
 *
 * 선택지는 최근 위시 100건(`WISH_OPTION_LIMIT`)만 가져온다. 공간에 위시가 그보다 많고 연결된 위시가
 * 오래된 것이면 목록에 없어, `<select value={uuid}>`에 맞는 `<option>`이 없어진다. 그러면 아무것도
 * 고르지 않은 것처럼 보인다(실제 값은 유지되므로 저장하면 연결은 남는다 — 표시만 어긋난다).
 * 조회에 실패했을 때도 같은 문제가 생긴다(독립 검토 P3-1).
 *
 * 그래서 연결된 위시가 선택지에 없으면 **맨 앞에 끼워 넣는다.** 목록 조회의 성공·실패를 구분하지 않고
 * 한 규칙으로 처리한다.
 */
export function withLinkedWishOption(
  options: readonly WishOption[],
  link: { id: string | null; title: string | null },
): WishOption[] {
  if (link.id === null) return [...options];
  if (options.some((option) => option.id === link.id)) return [...options];
  return [{ id: link.id, title: link.title ?? '연결된 위시', status: 'wish' }, ...options];
}
