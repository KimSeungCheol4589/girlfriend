import type { LiveMemory } from '@/features/memories/live/types';

import type { PinCandidate } from './types';

/**
 * 홈 고정 후보 목록 (DESIGN.md 4.2 "추억 고정").
 *
 * 고정은 꾸미기 저장과 **다른 저장**이다. `space_settings`에는 고정한 기록 ID가 들어가지 않고,
 * 기록 행의 `is_pinned`를 기존 `setMemoryPinnedAction`으로 한 건씩 바꾼다. 그래서 화면도
 * "꾸미기 저장"과 "고정 저장"을 섞지 않고, 각각의 성공·실패를 따로 보여 준다.
 *
 * 고정 저장에는 **서버가 렌더한 스냅샷 그대로**를 보낸다(추억 상세와 같은 방식). 서버가 다시 읽지
 * 않으므로 응답을 잃은 재시도가 같은 페이로드·같은 requestId로 DB 멱등성에 합류하고, 그 사이
 * 상대가 저장했다면 버전이 달라 충돌로 거부된다(상대 수정을 덮어쓰지 않는다).
 */

export function toPinCandidate(memory: LiveMemory): PinCandidate {
  return {
    id: memory.id,
    title: memory.title,
    memoryDate: memory.memoryDate,
    isPinned: memory.isPinned,
    snapshot: {
      title: memory.title,
      body: memory.body,
      memoryDate: memory.memoryDate,
      location: memory.location ?? '',
      tags: [...memory.tags],
      photoAssetIds: memory.photos.map((photo) => photo.assetId),
      expectedVersion: memory.version,
    },
  };
}

/**
 * 고정된 기록을 먼저, 그 뒤에 최근 기록을 잇는다.
 *
 * 목록 첫 페이지(20개)에 들어오지 않은 고정 기록이 **조용히 빠지지 않게** 고정 목록을 따로 읽어
 * 앞에 둔다. 같은 기록이 양쪽에 있으면 한 번만 남긴다(뒤에 오는 중복을 버린다).
 */
export function mergePinCandidates(
  pinned: readonly PinCandidate[],
  recent: readonly PinCandidate[],
): PinCandidate[] {
  const seen = new Set<string>();
  const result: PinCandidate[] = [];
  for (const candidate of [...pinned, ...recent]) {
    const key = candidate.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

/** 이미 목록에 있는 기록은 더 보기 결과에서 뺀다(같은 기록이 두 줄로 보이지 않게). */
export function appendPinCandidates(
  current: readonly PinCandidate[],
  added: readonly PinCandidate[],
): PinCandidate[] {
  return mergePinCandidates(current, added);
}

/**
 * 고정 저장 성공 후의 목록. 저장한 기록만 새 상태·새 버전으로 바꾼다.
 * 다음 저장이 옛 버전을 보내 충돌하지 않도록 버전을 반드시 갱신한다.
 */
export function applyPinSaved(
  candidates: readonly PinCandidate[],
  memoryId: string,
  isPinned: boolean,
  version: number,
): PinCandidate[] {
  return candidates.map((candidate) =>
    candidate.id === memoryId
      ? { ...candidate, isPinned, snapshot: { ...candidate.snapshot, expectedVersion: version } }
      : candidate,
  );
}
