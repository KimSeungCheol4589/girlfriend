import { describe, expect, it } from 'vitest';

import {
  defaultHomeSections,
  moveHomeSection,
  parseHomeSections,
  sameHomeSections,
  toHomeSectionsPayload,
  toggleHomeSection,
  visibleHomeSections,
  type HomeSection,
} from '@/features/customize/sections';

/**
 * 홈 섹션 규칙(DESIGN.md 4.2): 세 키를 정확히 한 번씩, 순서와 표시 여부만 바꾼다.
 * DB에 저장된 값이 흐트러져 있어도 화면이 섹션을 조용히 잃지 않아야 한다.
 */

const order = (sections: readonly HomeSection[]) => sections.map((section) => section.key);

describe('parseHomeSections', () => {
  it('저장된 순서와 표시 여부를 그대로 읽는다', () => {
    const parsed = parseHomeSections([
      { key: 'wishlist', visible: false },
      { key: 'recentMemories', visible: true },
      { key: 'pinned', visible: true },
    ]);
    expect(order(parsed)).toEqual(['wishlist', 'recentMemories', 'pinned']);
    expect(parsed[0]?.visible).toBe(false);
  });

  it('값을 읽을 수 없으면 기본 순서(모두 표시)다', () => {
    for (const raw of [null, undefined, '[]', 42, {}]) {
      expect(parseHomeSections(raw)).toEqual(defaultHomeSections());
    }
  });

  it('빠진 키는 뒤에 붙여 섹션을 잃지 않는다', () => {
    const parsed = parseHomeSections([{ key: 'wishlist', visible: false }]);
    expect(order(parsed)).toEqual(['wishlist', 'pinned', 'recentMemories']);
    expect(parsed.filter((section) => section.visible).length).toBe(2);
  });

  it('중복·모르는 키·모양이 틀린 원소는 버린다', () => {
    const parsed = parseHomeSections([
      { key: 'pinned', visible: true },
      { key: 'pinned', visible: false },
      { key: 'unknownSection', visible: true },
      'recentMemories',
      null,
    ]);
    expect(order(parsed)).toEqual(['pinned', 'recentMemories', 'wishlist']);
    // 첫 번째 값이 이긴다(뒤의 중복이 표시 여부를 덮지 않는다).
    expect(parsed[0]?.visible).toBe(true);
  });

  it('visible이 명시적으로 false일 때만 숨김이다', () => {
    const parsed = parseHomeSections([
      { key: 'pinned', visible: false },
      { key: 'recentMemories' },
      { key: 'wishlist', visible: 'yes' },
    ]);
    expect(parsed.map((section) => section.visible)).toEqual([false, true, true]);
  });
});

describe('순서·표시 편집', () => {
  it('위로 이동은 앞 항목과 자리를 바꾼다', () => {
    const moved = moveHomeSection(defaultHomeSections(), 'recentMemories', 'up');
    expect(order(moved)).toEqual(['recentMemories', 'pinned', 'wishlist']);
  });

  it('끝에서 더 이동하면 순서가 그대로다', () => {
    const sections = defaultHomeSections();
    expect(order(moveHomeSection(sections, 'pinned', 'up'))).toEqual(order(sections));
    expect(order(moveHomeSection(sections, 'wishlist', 'down'))).toEqual(order(sections));
  });

  it('이동·토글은 원본을 바꾸지 않는다', () => {
    const sections = defaultHomeSections();
    moveHomeSection(sections, 'wishlist', 'up');
    toggleHomeSection(sections, 'pinned');
    expect(order(sections)).toEqual(['pinned', 'recentMemories', 'wishlist']);
    expect(sections.every((section) => section.visible)).toBe(true);
  });

  it('토글은 그 섹션의 표시 여부만 바꾼다', () => {
    const toggled = toggleHomeSection(defaultHomeSections(), 'wishlist');
    expect(toggled.map((section) => section.visible)).toEqual([true, true, false]);
    expect(order(toggled)).toEqual(['pinned', 'recentMemories', 'wishlist']);
  });

  it('저장 값은 두 필드만 남긴다', () => {
    const payload = toHomeSectionsPayload([
      { key: 'pinned', visible: true },
      { key: 'recentMemories', visible: false },
      { key: 'wishlist', visible: true },
    ]);
    expect(payload).toEqual([
      { key: 'pinned', visible: true },
      { key: 'recentMemories', visible: false },
      { key: 'wishlist', visible: true },
    ]);
    expect(Object.keys(payload[0] ?? {})).toEqual(['key', 'visible']);
  });
});

describe('홈이 그릴 섹션', () => {
  it('순서를 유지하고 숨긴 것을 뺀다', () => {
    const sections = toggleHomeSection(
      moveHomeSection(defaultHomeSections(), 'wishlist', 'up'),
      'recentMemories',
    );
    expect(visibleHomeSections(sections)).toEqual(['pinned', 'wishlist']);
  });

  it('모두 숨기면 빈 목록이다', () => {
    let sections = defaultHomeSections();
    for (const key of ['pinned', 'recentMemories', 'wishlist'] as const) {
      sections = toggleHomeSection(sections, key);
    }
    expect(visibleHomeSections(sections)).toEqual([]);
  });
});

describe('sameHomeSections', () => {
  it('순서가 다르면 다르다', () => {
    expect(sameHomeSections(defaultHomeSections(), moveHomeSection(defaultHomeSections(), 'wishlist', 'up'))).toBe(
      false,
    );
  });

  it('표시 여부가 다르면 다르다', () => {
    expect(sameHomeSections(defaultHomeSections(), toggleHomeSection(defaultHomeSections(), 'pinned'))).toBe(false);
  });

  it('값이 같으면 같다(참조가 달라도)', () => {
    expect(sameHomeSections(defaultHomeSections(), defaultHomeSections())).toBe(true);
  });
});
