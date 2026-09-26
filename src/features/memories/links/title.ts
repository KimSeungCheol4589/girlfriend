/**
 * 원본 제목을 추억 제목 칸에 안전하게 옮기기 — 순수 함수.
 *
 * 왜 그냥 `slice`를 쓰지 않는가:
 *   - 일정·위시 제목은 **100자**까지, 추억 제목은 **80자**까지다(DESIGN 5.2).
 *   - 세 곳이 "80자"를 서로 다르게 센다.
 *       * 브라우저 `input maxLength`와 폼의 글자수 표시 → UTF-16 **코드 유닛**(`String.length`)
 *       * Zod 4 `.max(80)`와 `char_length(title) <= 80` → **코드 포인트**
 *     이모지(😀)는 코드 포인트 1개에 코드 유닛 2개다. 코드 포인트 80개까지 채우면
 *     저장(Zod·DB)은 통과하지만 JS 길이가 160이 되어 폼 입력칸에는 "80자 초과"로 보인다.
 *     그래서 가장 좁은 기준인 **코드 유닛**으로 맞춘다. 저장 한도보다 엄격한 대신 세 곳 모두 안전하다.
 *   - `slice(0, 80)`은 서로게이트 쌍을 반으로 끊어 깨진 문자를 만들 수 있다.
 *
 * 그래서 **코드 유닛 상한**을 기준으로 자르고, 경계는 **grapheme(사용자가 보는 글자)** 단위로 잡는다.
 * 코드 유닛 ≥ 코드 포인트이므로 유닛 80 이하면 DB의 코드 포인트 80도 함께 만족한다.
 *
 * 자른 사실은 **숨기지 않는다.** 호출자가 `truncated`로 안내하고 사용자가 고칠 수 있게 한다.
 */

export type FittedTitle = {
  /** 제한을 통과하는 제목. 앞뒤 공백은 정리한다. */
  value: string;
  /** 원문보다 짧아졌는지. true면 화면이 "줄였어요"를 안내한다. */
  truncated: boolean;
};

type SegmenterLike = {
  segment: (input: string) => Iterable<{ segment: string }>;
};

function graphemeSegmenter(): SegmenterLike | null {
  // Intl.Segmenter는 Node 16+·최신 브라우저에 있다. 없으면 코드 포인트 단위로 물러난다.
  const intl = Intl as unknown as { Segmenter?: new (locale?: string, options?: object) => SegmenterLike };
  if (typeof intl.Segmenter !== 'function') return null;
  try {
    return new intl.Segmenter('ko', { granularity: 'grapheme' });
  } catch {
    return null;
  }
}

const SEGMENTER = graphemeSegmenter();

/** 사용자가 보는 글자 단위로 쪼갠다. Segmenter가 없으면 코드 포인트 단위다(서로게이트는 깨지지 않는다). */
export function splitGraphemes(value: string): string[] {
  if (SEGMENTER) {
    const result: string[] = [];
    for (const part of SEGMENTER.segment(value)) result.push(part.segment);
    return result;
  }
  return Array.from(value);
}

/**
 * `limit`은 **UTF-16 코드 유닛** 상한이다(`String.prototype.length`와 같은 단위).
 * 한 글자가 상한보다 길면 그 글자는 넣지 않는다(깨진 조각을 만들지 않는다).
 */
export function fitTitle(raw: string, limit: number): FittedTitle {
  const trimmed = raw.trim();
  if (trimmed.length <= limit) return { value: trimmed, truncated: false };

  let taken = '';
  for (const grapheme of splitGraphemes(trimmed)) {
    if (taken.length + grapheme.length > limit) break;
    taken += grapheme;
  }

  // 끝에 걸린 공백은 남기지 않는다. DB의 `title = btrim(title)` 제약과도 맞춘다.
  const value = taken.trimEnd();
  return { value, truncated: value !== trimmed };
}

/**
 * 장소도 같은 방식으로 맞춘다. 일정과 추억의 장소 상한은 현재 둘 다 100자지만,
 * 한쪽이 바뀌어도 깨진 문자를 만들지 않도록 같은 함수를 쓴다.
 */
export function fitLocation(raw: string | null, limit: number): FittedTitle {
  if (raw === null) return { value: '', truncated: false };
  return fitTitle(raw, limit);
}
