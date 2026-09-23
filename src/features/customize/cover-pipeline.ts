import type { SaveCustomizationData } from './types';

/**
 * 아직 저장하지 않은 커버 파일의 수명 규칙(순수 함수).
 *
 * 커버 업로드는 저장과 **다른 시점**에 끝난다. 확정(ready)된 파일은 `save_customization`이
 * 설정에 붙이기 전까지는 어디에도 연결되지 않은 내 파일이다. 그래서 다음을 구분해야 한다.
 *
 *   - `draft`  : 이번 화면에서 올렸고 아직 저장에 성공하지 않은 파일 → 교체·해제·이탈 시 정리 대상.
 *   - `saved`  : 설정에 붙어 있는 파일 → **절대 정리하지 않는다.** 응답을 잃은 재시도 뒤에
 *                같은 파일을 지우면 방금 저장한 커버가 사라진다(DB도 첨부된 asset의 취소를 거부한다).
 *   - 저장 진행 중 : 결과를 모르는 동안에는 정리하지 않는다. 남으면 24시간 만료 정리가 맡는다.
 *
 * 마지막 규칙은 "지웠는데 사실은 저장됐다"보다 "안 지웠는데 사실은 버려졌다"가 안전하기 때문이다.
 */

export type PendingCoverPlan =
  | { discard: string; reason: 'draft' }
  | { discard: null; reason: 'none' | 'committed' | 'save_in_flight' };

export function planPendingCoverDiscard(input: {
  /** 이번 화면에서 올려 확정한 파일. 없으면 null. */
  pendingAssetId: string | null;
  /** 서버가 알려 준, 지금 설정에 붙어 있는 커버. */
  savedCoverAssetId: string | null;
  /** 저장 요청이 아직 끝나지 않았는지. */
  saveInFlight: boolean;
}): PendingCoverPlan {
  const pending = input.pendingAssetId;
  if (!pending) return { discard: null, reason: 'none' };
  if (same(pending, input.savedCoverAssetId)) return { discard: null, reason: 'committed' };
  if (input.saveInFlight) return { discard: null, reason: 'save_in_flight' };
  return { discard: pending, reason: 'draft' };
}

/**
 * 저장 성공 뒤 남길 pending 값.
 * 서버가 이 파일을 커버로 받아들였으면 소유권이 설정으로 넘어간 것이므로 정리 대상에서 뺀다.
 */
export function pendingAfterSave(pendingAssetId: string | null, result: SaveCustomizationData): string | null {
  if (!pendingAssetId) return null;
  return same(pendingAssetId, result.coverAssetId) ? null : pendingAssetId;
}

function same(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * 저장 성공 안내. 정리 실패는 **저장 실패가 아니다**(DESIGN.md 8.3).
 * 설정은 이미 저장됐고, 떼어 낸 이전 커버 파일만 나중에 다시 정리한다.
 */
export function savedNoticeText(result: SaveCustomizationData): string {
  const base = '꾸미기 설정을 저장했어요. 상대방이 홈을 새로 열면 같은 설정이 보입니다.';
  if (result.cleanup !== 'pending') return base;
  return `${base} 이전 커버 파일 정리는 끝나지 않아 나중에 다시 정리합니다(아무에게도 보이지 않아요).`;
}
