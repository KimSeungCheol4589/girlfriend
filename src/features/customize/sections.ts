import { HOME_SECTION_KEYS, type HomeSectionKey } from '@/lib/contracts';

/**
 * 홈 섹션 순서·표시 여부 (DESIGN.md 4.2).
 *
 * 세 키(`pinned`, `recentMemories`, `wishlist`)를 정확히 한 번씩 포함하고 **순서와 표시 여부만** 바꾼다.
 * DB(`space_settings.home_sections`)도 같은 구조를 검증하지만, 저장된 값이 과거 버전·다른 도구로
 * 흐트러져 있을 수 있으므로 읽을 때 한 번 더 정규화한다. 정규화는 화면을 비우지 않기 위한 것이고,
 * 저장은 항상 검증을 통과한 값만 보낸다.
 */

export type HomeSection = { key: HomeSectionKey; visible: boolean };

export const DEFAULT_HOME_SECTIONS: readonly HomeSection[] = HOME_SECTION_KEYS.map((key) => ({
  key,
  visible: true,
}));

export function defaultHomeSections(): HomeSection[] {
  return DEFAULT_HOME_SECTIONS.map((section) => ({ ...section }));
}

function isHomeSectionKey(value: unknown): value is HomeSectionKey {
  return typeof value === 'string' && (HOME_SECTION_KEYS as readonly string[]).includes(value);
}

/**
 * DB의 `home_sections` jsonb → 화면이 쓰는 목록.
 *
 * - 알아볼 수 있는 키는 **저장된 순서대로** 유지한다.
 * - 빠진 키는 기본 순서 자리에서 뒤에 붙이고 `visible: true`로 둔다(섹션을 조용히 잃지 않는다).
 * - 중복·모르는 키·모양이 틀린 원소는 버린다.
 * - 값 자체를 못 읽으면 기본값이다.
 */
export function parseHomeSections(raw: unknown): HomeSection[] {
  if (!Array.isArray(raw)) return defaultHomeSections();

  const result: HomeSection[] = [];
  const seen = new Set<HomeSectionKey>();

  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const { key, visible } = item as { key?: unknown; visible?: unknown };
    if (!isHomeSectionKey(key) || seen.has(key)) continue;
    seen.add(key);
    result.push({ key, visible: visible !== false });
  }

  for (const key of HOME_SECTION_KEYS) {
    if (!seen.has(key)) result.push({ key, visible: true });
  }

  return result;
}

/** 저장용 값. 순서를 그대로 두고 두 필드만 남긴다. */
export function toHomeSectionsPayload(sections: readonly HomeSection[]): { key: HomeSectionKey; visible: boolean }[] {
  return sections.map((section) => ({ key: section.key, visible: section.visible }));
}

/** 위·아래 이동. 끝에서 더 이동하면 같은 순서를 돌려준다. */
export function moveHomeSection(
  sections: readonly HomeSection[],
  key: HomeSectionKey,
  direction: 'up' | 'down',
): HomeSection[] {
  const index = sections.findIndex((section) => section.key === key);
  if (index === -1) return sections.map((section) => ({ ...section }));

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= sections.length) return sections.map((section) => ({ ...section }));

  const next = sections.map((section) => ({ ...section }));
  const moved = next[index] as HomeSection;
  next[index] = next[target] as HomeSection;
  next[target] = moved;
  return next;
}

export function toggleHomeSection(sections: readonly HomeSection[], key: HomeSectionKey): HomeSection[] {
  return sections.map((section) =>
    section.key === key ? { ...section, visible: !section.visible } : { ...section },
  );
}

export function sameHomeSections(a: readonly HomeSection[], b: readonly HomeSection[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((section, index) => {
    const other = b[index];
    return other !== undefined && other.key === section.key && other.visible === section.visible;
  });
}

/** 홈이 실제로 그릴 섹션(순서 유지, 숨긴 것 제외). 전부 숨기면 빈 배열이다. */
export function visibleHomeSections(sections: readonly HomeSection[]): HomeSectionKey[] {
  return sections.filter((section) => section.visible).map((section) => section.key);
}
