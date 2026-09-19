import { describe, expect, it } from 'vitest';

import {
  cloneCustomization,
  isSameCustomization,
  moveSection,
  toggleSection,
  validateCustomization,
} from '@/features/customization/schema';
import type { DemoCustomization, DemoHomeSection } from '@/lib/demo/types';

const sections: DemoHomeSection[] = [
  { key: 'pinned', visible: true },
  { key: 'recentMemories', visible: true },
  { key: 'wishlist', visible: true },
];

function customization(overrides: Partial<DemoCustomization> = {}): DemoCustomization {
  return {
    themeKey: 'cream',
    accentColor: '#8B435A',
    // 커버 업로드 전에는 항상 null이다. 커버 미리보기는 계약 바깥 값이라 여기에 없다.
    coverAssetId: null,
    sections: sections.map((section) => ({ ...section })),
    ...overrides,
  };
}

describe('validateCustomization', () => {
  it('기본 설정을 통과시킨다', () => {
    expect(validateCustomization(customization()).ok).toBe(true);
  });

  it('테마 3종만 허용한다', () => {
    expect(validateCustomization(customization({ themeKey: 'rose' })).ok).toBe(true);
    expect(validateCustomization(customization({ themeKey: 'sage' })).ok).toBe(true);
    expect(
      validateCustomization({ ...customization(), themeKey: 'midnight' }).ok,
    ).toBe(false);
  });

  it('포인트 색상은 #RRGGBB만 받는다', () => {
    expect(validateCustomization(customization({ accentColor: '#abcdef' })).ok).toBe(true);
    expect(validateCustomization(customization({ accentColor: '#ABC' })).ok).toBe(false);
    expect(validateCustomization(customization({ accentColor: 'red' })).ok).toBe(false);
    expect(
      validateCustomization(customization({ accentColor: 'javascript:alert(1)' })).ok,
    ).toBe(false);
  });

  it('섹션 키가 중복되면 거부한다', () => {
    const result = validateCustomization(
      customization({
        sections: [
          { key: 'pinned', visible: true },
          { key: 'pinned', visible: true },
          { key: 'wishlist', visible: true },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('한 번씩');
  });

  it('섹션이 빠지면 거부한다', () => {
    expect(
      validateCustomization(customization({ sections: sections.slice(0, 2) })).ok,
    ).toBe(false);
  });

  it('순서가 바뀌거나 숨겨도 통과한다', () => {
    expect(
      validateCustomization(
        customization({
          sections: [
            { key: 'wishlist', visible: false },
            { key: 'pinned', visible: true },
            { key: 'recentMemories', visible: false },
          ],
        }),
      ).ok,
    ).toBe(true);
  });
});

describe('moveSection', () => {
  it('위로 한 칸 옮긴다', () => {
    expect(moveSection(sections, 'recentMemories', 'up').map((s) => s.key)).toEqual([
      'recentMemories',
      'pinned',
      'wishlist',
    ]);
  });

  it('아래로 한 칸 옮긴다', () => {
    expect(moveSection(sections, 'pinned', 'down').map((s) => s.key)).toEqual([
      'recentMemories',
      'pinned',
      'wishlist',
    ]);
  });

  it('끝에서 더 못 옮긴다', () => {
    expect(moveSection(sections, 'pinned', 'up').map((s) => s.key)).toEqual([
      'pinned',
      'recentMemories',
      'wishlist',
    ]);
    expect(moveSection(sections, 'wishlist', 'down').map((s) => s.key)).toEqual([
      'pinned',
      'recentMemories',
      'wishlist',
    ]);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const input = sections.map((section) => ({ ...section }));
    moveSection(input, 'pinned', 'down');
    expect(input.map((s) => s.key)).toEqual(['pinned', 'recentMemories', 'wishlist']);
  });

  it('여러 번 옮겨도 세 키가 그대로 유지된다', () => {
    let next = moveSection(sections, 'wishlist', 'up');
    next = moveSection(next, 'wishlist', 'up');
    expect(next.map((s) => s.key)).toEqual(['wishlist', 'pinned', 'recentMemories']);
    expect(validateCustomization(customization({ sections: next })).ok).toBe(true);
  });
});

describe('toggleSection', () => {
  it('해당 섹션만 표시 여부를 뒤집는다', () => {
    const next = toggleSection(sections, 'wishlist');
    expect(next.map((s) => s.visible)).toEqual([true, true, false]);
  });

  it('두 번 누르면 원래대로 돌아온다', () => {
    const next = toggleSection(toggleSection(sections, 'pinned'), 'pinned');
    expect(next).toEqual(sections);
  });
});

describe('isSameCustomization / cloneCustomization', () => {
  it('같은 값이면 참이다', () => {
    expect(isSameCustomization(customization(), customization())).toBe(true);
  });

  it('색상 대소문자는 같은 값으로 본다', () => {
    expect(
      isSameCustomization(customization({ accentColor: '#8b435a' }), customization()),
    ).toBe(true);
  });

  it('테마·색상·순서·표시 여부가 다르면 거짓이다', () => {
    expect(isSameCustomization(customization({ themeKey: 'rose' }), customization())).toBe(false);
    expect(isSameCustomization(customization({ accentColor: '#000000' }), customization())).toBe(
      false,
    );
    expect(
      isSameCustomization(
        customization({ sections: moveSection(sections, 'pinned', 'down') }),
        customization(),
      ),
    ).toBe(false);
    expect(
      isSameCustomization(
        customization({ sections: toggleSection(sections, 'pinned') }),
        customization(),
      ),
    ).toBe(false);
  });

  it('복제본은 원본과 배열을 공유하지 않는다', () => {
    const original = customization();
    const copy = cloneCustomization(original);
    copy.sections[0] = { key: 'pinned', visible: false };
    expect(original.sections[0]?.visible).toBe(true);
    expect(isSameCustomization(original, copy)).toBe(false);
  });
});
