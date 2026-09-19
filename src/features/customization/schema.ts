import { z } from 'zod';

import { HOME_SECTION_KEYS, THEME_KEYS, type HomeSectionKey } from '@/lib/contracts';
import { isHexColor } from '@/lib/theme';
import type { DemoCustomization, DemoHomeSection } from '@/lib/demo/types';

/**
 * 꾸미기 저장 모델. DESIGN.md 4.2의 구조를 따른다.
 * 섹션 키는 정확히 한 번씩 포함하고 순서와 표시 여부만 바꿀 수 있다.
 */
export const homeSectionSchema = z.object({
  key: z.enum(HOME_SECTION_KEYS),
  visible: z.boolean(),
});

export const customizationSchema = z
  .object({
    themeKey: z.enum(THEME_KEYS),
    accentColor: z
      .string()
      .refine(isHexColor, '포인트 색상은 #RRGGBB 형식이어야 해요.'),
    // Storage에 올라간 커버 파일의 asset ID. 업로드를 구현하기 전에는 항상 null이다.
    // 브라우저 미리보기 주소(blob:)는 이 값이 될 수 없다.
    coverAssetId: z
      .string()
      .uuid('커버 asset ID 형식이 아니에요.')
      .nullable(),
    sections: z.array(homeSectionSchema).length(HOME_SECTION_KEYS.length),
  })
  .superRefine((value, ctx) => {
    const keys = value.sections.map((section) => section.key);
    const unique = new Set(keys);
    const missing = HOME_SECTION_KEYS.filter((key) => !unique.has(key));

    if (unique.size !== keys.length || missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: '홈 섹션은 세 가지가 한 번씩만 들어가야 해요.',
      });
    }
  });

export type CustomizationInput = z.infer<typeof customizationSchema>;

export type CustomizationValidationResult =
  | { ok: true; data: CustomizationInput }
  | { ok: false; message: string };

export function validateCustomization(input: unknown): CustomizationValidationResult {
  const parsed = customizationSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const first = parsed.error.issues[0];
  return { ok: false, message: first?.message ?? '꾸미기 설정을 확인해 주세요.' };
}

/** 위·아래 이동 버튼의 동작. 끝에서 더 이동하면 원본을 그대로 돌려준다. */
export function moveSection(
  sections: readonly DemoHomeSection[],
  key: HomeSectionKey,
  direction: 'up' | 'down',
): DemoHomeSection[] {
  const index = sections.findIndex((section) => section.key === key);
  if (index === -1) return [...sections];

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= sections.length) return [...sections];

  const next = [...sections];
  const moved = next[index] as DemoHomeSection;
  const displaced = next[target] as DemoHomeSection;
  next[target] = moved;
  next[index] = displaced;
  return next;
}

export function toggleSection(
  sections: readonly DemoHomeSection[],
  key: HomeSectionKey,
): DemoHomeSection[] {
  return sections.map((section) =>
    section.key === key ? { ...section, visible: !section.visible } : { ...section },
  );
}

/** 미저장 상태 경고에 사용한다. 값 비교만 하고 참조 동일성에 기대지 않는다. */
export function isSameCustomization(a: DemoCustomization, b: DemoCustomization): boolean {
  if (a.themeKey !== b.themeKey) return false;
  if (a.accentColor.toLowerCase() !== b.accentColor.toLowerCase()) return false;
  if (a.coverAssetId !== b.coverAssetId) return false;
  if (a.sections.length !== b.sections.length) return false;
  return a.sections.every((section, index) => {
    const other = b.sections[index];
    return other !== undefined && other.key === section.key && other.visible === section.visible;
  });
}

export function cloneCustomization(value: DemoCustomization): DemoCustomization {
  return {
    themeKey: value.themeKey,
    accentColor: value.accentColor,
    coverAssetId: value.coverAssetId,
    sections: value.sections.map((section) => ({ ...section })),
  };
}

/** 색상 선택 편의를 위한 프리셋. 자유 입력도 허용한다. */
export const ACCENT_PRESETS: readonly { value: string; label: string }[] = [
  { value: '#8B435A', label: '자두' },
  { value: '#C06C82', label: '로즈' },
  { value: '#B4708A', label: '말린 장미' },
  { value: '#6F8F72', label: '세이지' },
  { value: '#A9713F', label: '캐러멜' },
  { value: '#4F6D8C', label: '흐린 하늘' },
];
