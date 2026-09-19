import { checkImageCandidate, isLocalPreviewUrl, type ImageCandidate } from '@/lib/images';
import type { DemoCoverPreview } from '@/lib/demo/types';

/**
 * 커버 이미지 고르기 (데모 범위).
 *
 * 추억 사진과 같은 형식·용량 규칙을 쓴다. 파일을 어디에도 올리지 않고
 * 브라우저 미리보기 주소만 만든다. 그래서 결과는 `coverAssetId`가 아니라
 * 별도의 DemoCoverPreview로 돌려준다.
 */

export type CoverSelectionResult =
  | { ok: true; preview: DemoCoverPreview }
  | { ok: false; reason: string };

/**
 * 고른 파일과 브라우저가 만든 objectURL로 미리보기 값을 만든다.
 * objectURL 생성은 호출부에서 하고(브라우저 API), 여기서는 검증과 조립만 한다.
 */
export function createCoverPreview(
  candidate: ImageCandidate,
  objectUrl: string,
  id: string,
): CoverSelectionResult {
  const problem = checkImageCandidate(candidate);
  if (problem !== null) {
    return { ok: false, reason: problem };
  }

  if (!isLocalPreviewUrl(objectUrl)) {
    return {
      ok: false,
      reason: '브라우저 미리보기 주소를 만들지 못했어요. 다시 골라 주세요.',
    };
  }

  return {
    ok: true,
    preview: {
      id,
      objectUrl,
      fileName: candidate.name,
      alt: `${candidate.name} 커버 미리보기`,
    },
  };
}

/** 미저장 변경 확인에 쓴다. 값 비교만 한다. */
export function isSameCover(
  a: DemoCoverPreview | null,
  b: DemoCoverPreview | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.objectUrl === b.objectUrl;
}
