import { describe, expect, it } from 'vitest';

import { fitLocation, fitTitle, splitGraphemes } from '@/features/memories/links/title';
import { MEMORY_LIMITS } from '@/lib/contracts';
import { saveMemoryInputSchema } from '@/features/memories/live/input-schema';

/**
 * 일정·위시 제목(최대 100자)을 추억 제목 칸(최대 80자)으로 옮길 때의 안전 규칙.
 *
 * 세 곳이 "80자"를 다르게 센다.
 *   * 브라우저 `maxLength`와 폼의 글자수 표시 → UTF-16 **코드 유닛**(`String.length`)
 *   * Zod 4 `.max(80)`, PostgreSQL `char_length(...) <= 80` → **코드 포인트**
 * 이모지는 코드 포인트 1개에 유닛 2개다. 가장 좁은 기준인 코드 유닛으로 자르면 세 곳을 모두 지킨다.
 *
 * 그리고 자른 사실을 숨기지 않는다(`truncated`).
 */

const LIMIT = MEMORY_LIMITS.titleMax;

/** DB의 `char_length`와 같은 단위. */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

function passesEveryLimit(value: string): boolean {
  return value.length <= LIMIT && codePointLength(value) <= LIMIT;
}

describe('추억 제목 상한 상수', () => {
  it('80자다(마이그레이션의 memories_title_length와 같은 값)', () => {
    expect(LIMIT).toBe(80);
  });
});

describe('fitTitle — 길이', () => {
  it('79·80자는 그대로 둔다', () => {
    for (const length of [79, 80]) {
      const raw = '가'.repeat(length);
      expect(fitTitle(raw, LIMIT)).toEqual({ value: raw, truncated: false });
    }
  });

  it('81자는 80자로 줄이고 알린다', () => {
    const result = fitTitle('가'.repeat(81), LIMIT);
    expect(result.value).toHaveLength(80);
    expect(result.truncated).toBe(true);
  });

  it('위시·일정의 100자 제목도 통과하는 길이로 줄인다', () => {
    const result = fitTitle('나'.repeat(MEMORY_LIMITS.titleMax + 20), LIMIT);
    expect(result.truncated).toBe(true);
    expect(passesEveryLimit(result.value)).toBe(true);
  });

  it('빈 제목·공백만 있는 제목은 빈 문자열이다(줄인 것이 아니다)', () => {
    expect(fitTitle('', LIMIT)).toEqual({ value: '', truncated: false });
    expect(fitTitle('   ', LIMIT)).toEqual({ value: '', truncated: false });
  });

  it('앞뒤 공백은 정리한다(DB의 btrim 제약과 같은 기준)', () => {
    expect(fitTitle('  한강 산책  ', LIMIT).value).toBe('한강 산책');
  });

  it('자른 끝에 공백을 남기지 않는다', () => {
    // 79번째까지 글자, 80번째가 공백인 제목.
    const raw = `${'가'.repeat(79)} 뒷부분`;
    const result = fitTitle(raw, LIMIT);
    expect(result.value.endsWith(' ')).toBe(false);
    expect(result.truncated).toBe(true);
  });
});

describe('fitTitle — 이모지와 결합 문자', () => {
  it('이모지 80개는 코드 유닛이 160이라 그대로 쓸 수 없다', () => {
    const raw = '😀'.repeat(80);
    expect(raw.length).toBe(160);
    expect(codePointLength(raw)).toBe(80);

    const result = fitTitle(raw, LIMIT);
    expect(result.truncated).toBe(true);
    // 두 제한을 모두 통과한다.
    expect(passesEveryLimit(result.value)).toBe(true);
    // 유닛 기준으로 40개가 들어간다.
    expect(codePointLength(result.value)).toBe(40);
  });

  it('서로게이트 쌍을 반으로 끊지 않는다', () => {
    const result = fitTitle('😀'.repeat(50), LIMIT);
    // 깨진 조각이 있으면 왕복 변환에서 치환 문자(U+FFFD)가 나온다.
    expect(result.value).not.toContain('�');
    expect([...result.value].every((char) => char === '😀')).toBe(true);
  });

  it('ZWJ로 이어진 이모지를 중간에서 끊지 않는다', () => {
    // 가족 이모지: 사람 + ZWJ + 사람 + ZWJ + 아이 (코드 유닛 8, 코드 포인트 5)
    const family = '👨‍👩‍👧';
    expect(family.length).toBe(8);
    const raw = family.repeat(11); // 유닛 88 > 80
    const result = fitTitle(raw, LIMIT);
    expect(result.truncated).toBe(true);
    expect(passesEveryLimit(result.value)).toBe(true);
    // 잘린 결과는 온전한 가족 이모지의 반복이어야 한다(Segmenter가 없으면 코드 포인트 경계).
    expect(result.value).toBe(family.repeat(Math.floor(result.value.length / family.length)));
  });

  it('한글 자모 결합(NFD)도 유닛 상한을 넘기지 않는다', () => {
    const decomposed = '한강'.normalize('NFD').repeat(40);
    const result = fitTitle(decomposed, LIMIT);
    expect(passesEveryLimit(result.value)).toBe(true);
  });

  it('한 글자가 상한보다 길면 아무것도 넣지 않는다(깨진 조각을 만들지 않는다)', () => {
    const result = fitTitle('😀', 1);
    expect(result.value).toBe('');
    expect(result.truncated).toBe(true);
  });
});

describe('fitTitle 결과는 실제 저장 검증을 통과한다', () => {
  const base = {
    memoryId: null,
    body: '',
    memoryDate: '2020-01-01',
    location: '',
    tags: [],
    photoAssetIds: [],
    isPinned: false,
    expectedVersion: 0,
    requestId: '11111111-2222-4333-8444-555555555555',
  };

  it('이모지·한글 긴 제목이 Zod 검증을 통과한다', () => {
    for (const raw of ['😀'.repeat(80), '가'.repeat(100), `${'나'.repeat(70)}😀😀😀😀😀😀`]) {
      const fitted = fitTitle(raw, LIMIT);
      const parsed = saveMemoryInputSchema.safeParse({ ...base, title: fitted.value });
      expect(parsed.success, `제목 원문 길이 ${raw.length}`).toBe(true);
    }
  });

  it('코드 포인트 상한을 넘는 원문은 Zod 검증에서 거부된다(자르는 이유)', () => {
    // Zod 4의 `.max()`는 코드 포인트를 센다(DB `char_length`와 같은 단위).
    // 이모지 81개 = 코드 포인트 81 > 80 이므로 원문 그대로는 저장할 수 없다.
    const raw = '😀'.repeat(81);
    expect([...raw]).toHaveLength(81);
    expect(saveMemoryInputSchema.safeParse({ ...base, title: raw }).success).toBe(false);

    // 같은 원문을 fitTitle로 맞추면 통과한다.
    const fitted = fitTitle(raw, LIMIT);
    expect(fitted.truncated).toBe(true);
    expect(saveMemoryInputSchema.safeParse({ ...base, title: fitted.value }).success).toBe(true);
  });

  it('코드 유닛 기준으로 자르므로 Zod보다 엄격하다(폼 입력칸을 함께 만족시킨다)', () => {
    // 이모지 80개는 코드 포인트 80이라 Zod·DB는 통과시킨다.
    const raw = '😀'.repeat(80);
    expect(saveMemoryInputSchema.safeParse({ ...base, title: raw }).success).toBe(true);

    // 그래도 줄인다. 폼 입력칸의 maxLength와 글자수 표시는 코드 유닛(String.length)을 세기 때문에
    // 160유닛을 그대로 채우면 사용자에게 "80자 초과"로 보인다. 줄인 사실은 truncated로 알린다.
    const fitted = fitTitle(raw, LIMIT);
    expect(fitted.truncated).toBe(true);
    expect(fitted.value.length).toBeLessThanOrEqual(LIMIT);
    expect(splitGraphemes(fitted.value).every((g) => g === '😀')).toBe(true);
  });
});

describe('fitLocation', () => {
  it('null은 빈 문자열이다(위시에는 장소가 없다)', () => {
    expect(fitLocation(null, MEMORY_LIMITS.locationMax)).toEqual({ value: '', truncated: false });
  });

  it('100자 이내 장소는 그대로 쓴다', () => {
    expect(fitLocation('성수동 카페거리', MEMORY_LIMITS.locationMax)).toEqual({
      value: '성수동 카페거리',
      truncated: false,
    });
  });

  it('상한을 넘는 장소는 줄이고 알린다', () => {
    const result = fitLocation('가'.repeat(120), MEMORY_LIMITS.locationMax);
    expect(result.value).toHaveLength(MEMORY_LIMITS.locationMax);
    expect(result.truncated).toBe(true);
  });
});

describe('splitGraphemes', () => {
  it('이모지를 한 덩어리로 센다', () => {
    expect(splitGraphemes('a😀b')).toEqual(['a', '😀', 'b']);
  });

  it('빈 문자열은 빈 배열이다', () => {
    expect(splitGraphemes('')).toEqual([]);
  });
});
