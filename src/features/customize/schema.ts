import { z } from 'zod';

import { UUID_PATTERN } from '@/features/memories/live/ids';
import { HOME_SECTION_KEYS, THEME_KEYS } from '@/lib/contracts';
import { isHexColor } from '@/lib/theme';

import { COVER_MAX_BYTES, COVER_UPLOAD_MIME_TYPES } from './constants';
import type { HomeSection } from './sections';
import type { SavedCustomization } from './types';

/**
 * 꾸미기 서버 작업 입력 검증(Zod).
 *
 * DESIGN.md 4.2 / CONTRACTS.md 5의 `save_customization` 계약과 같은 규칙을 서버에서 다시 검사한다.
 * DB도 같은 규칙을 강제하므로 여기서 통과해도 최종 판단은 DB 결과를 따른다.
 *
 * 저장 값은 **설정 스냅샷**이다. 고정한 추억 ID는 들어가지 않는다(고정은 별도 저장이다).
 */

const uuid = z.string().regex(UUID_PATTERN);

export const homeSectionSchema = z.object({
  key: z.enum(HOME_SECTION_KEYS),
  visible: z.boolean(),
});

export const accentColorSchema = z
  .string()
  .trim()
  .refine(isHexColor, '포인트 색상은 #RRGGBB 형식으로 입력해 주세요.')
  // DB가 소문자로 정규화한다(CONTRACTS.md 5). 같은 색을 대소문자만 바꿔 보내 저장이
  // "바뀐 것처럼" 보이지 않도록 앱에서도 같은 형태로 맞춘다.
  .transform((value) => value.toLowerCase());

export const saveCustomizationInputSchema = z
  .object({
    themeKey: z.enum(THEME_KEYS),
    accentColor: accentColorSchema,
    /** Storage에 올라가 확정된 커버 asset ID. 해제는 null이다. 브라우저 blob: 주소는 들어올 수 없다. */
    coverAssetId: uuid.nullable(),
    sections: z.array(homeSectionSchema).length(HOME_SECTION_KEYS.length),
    expectedVersion: z.number().int().min(0),
    requestId: uuid,
  })
  .superRefine((value, ctx) => {
    const keys = value.sections.map((section) => section.key);
    const unique = new Set(keys);
    if (unique.size !== keys.length || unique.size !== HOME_SECTION_KEYS.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: '홈 섹션은 세 가지가 한 번씩만 들어가야 해요.',
      });
    }
  });

export type SaveCustomizationInput = z.infer<typeof saveCustomizationInputSchema>;

export const prepareCoverInputSchema = z.object({
  mimeType: z.enum(COVER_UPLOAD_MIME_TYPES),
  bytes: z.number().int().min(1).max(COVER_MAX_BYTES),
  requestId: uuid,
});

export const finalizeCoverInputSchema = z.object({
  assetId: uuid,
});

export const discardCoverInputSchema = z.object({
  assetId: uuid,
  requestId: uuid,
});

/** 화면이 편집 중인 값. 저장된 값과 같은 모양이지만 버전·업로더 정보는 들고 있지 않다. */
export type CustomizationDraft = {
  themeKey: SavedCustomization['themeKey'];
  accentColor: string;
  coverAssetId: string | null;
  sections: HomeSection[];
};

export function toDraft(saved: SavedCustomization): CustomizationDraft {
  return {
    themeKey: saved.themeKey,
    accentColor: saved.accentColor,
    coverAssetId: saved.coverAssetId,
    sections: saved.sections.map((section) => ({ ...section })),
  };
}

/**
 * 미저장 변경 판단. 값 비교만 하고 참조 동일성에 기대지 않는다.
 * 포인트 색상은 DB가 소문자로 정규화하므로 대소문자를 구분하지 않는다.
 */
export function sameCustomization(a: CustomizationDraft, b: CustomizationDraft): boolean {
  if (a.themeKey !== b.themeKey) return false;
  if (a.accentColor.toLowerCase() !== b.accentColor.toLowerCase()) return false;
  if (a.coverAssetId !== b.coverAssetId) return false;
  if (a.sections.length !== b.sections.length) return false;
  return a.sections.every((section, index) => {
    const other = b.sections[index];
    return other !== undefined && other.key === section.key && other.visible === section.visible;
  });
}

/**
 * 저장 요청의 멱등성 키를 만드는 입력 서명용 값.
 * 같은 내용을 다시 보내면 같은 키를, 내용을 고치면 새 키를 쓰게 한다(CONTRACTS.md 7-1).
 */
export function customizationSignatureValues(
  draft: CustomizationDraft,
  expectedVersion: number,
): Record<string, unknown> {
  return {
    themeKey: draft.themeKey,
    accentColor: draft.accentColor.toLowerCase(),
    coverAssetId: draft.coverAssetId,
    sections: draft.sections.map((section) => `${section.key}:${section.visible ? '1' : '0'}`),
    expectedVersion,
  };
}

/** 색상 선택 편의를 위한 프리셋. 자유 입력도 허용한다. */
export const ACCENT_PRESETS: readonly { value: string; label: string }[] = [
  { value: '#8b435a', label: '자두' },
  { value: '#c06c82', label: '로즈' },
  { value: '#b4708a', label: '말린 장미' },
  { value: '#6f8f72', label: '세이지' },
  { value: '#a9713f', label: '캐러멜' },
  { value: '#4f6d8c', label: '흐린 하늘' },
];
