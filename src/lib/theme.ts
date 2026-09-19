import { DEFAULT_ACCENT_COLOR, THEME_KEYS, type ThemeKey } from '@/lib/contracts';

export type ThemePreset = {
  key: ThemeKey;
  label: string;
  description: string;
  /** 커버·미리보기에 쓰는 합성 그라데이션. 외부 이미지를 내려받지 않는다. */
  coverGradient: string;
  swatch: readonly [string, string, string];
};

export const THEME_PRESETS: Record<ThemeKey, ThemePreset> = {
  cream: {
    key: 'cream',
    label: '크림',
    description: '아이보리 배경에 부드러운 종이 질감. 사진 색이 가장 그대로 보인다.',
    coverGradient:
      'linear-gradient(135deg, #FBF1E3 0%, #F6E3D2 42%, #EFD3C6 72%, #E7C3BE 100%)',
    swatch: ['#FBF7F1', '#F0E3D4', '#B4708A'],
  },
  rose: {
    key: 'rose',
    label: '로즈',
    description: '따뜻한 장밋빛 톤. 기념일과 고정 추억을 강조하기 좋다.',
    coverGradient:
      'linear-gradient(135deg, #FDEDEF 0%, #F7D9DF 40%, #EFC2CD 70%, #E0A9BC 100%)',
    swatch: ['#FDF5F5', '#F4DCE1', '#C06C82'],
  },
  sage: {
    key: 'sage',
    label: '세이지',
    description: '차분한 연녹색. 여행과 산책 기록이 많을 때 어울린다.',
    coverGradient:
      'linear-gradient(135deg, #F1F6EE 0%, #DFEBDA 40%, #CBDCC6 70%, #B4CBB2 100%)',
    swatch: ['#F4F7F2', '#DCE8D9', '#6F8F72'],
  },
};

export const THEME_PRESET_LIST: readonly ThemePreset[] = THEME_KEYS.map(
  (key) => THEME_PRESETS[key],
);

export function isThemeKey(value: string): value is ThemeKey {
  return (THEME_KEYS as readonly string[]).includes(value);
}

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{6})$/;

export function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

/** `#RRGGBB`를 0~255 채널로 분해한다. 형식이 다르면 null이다. */
export function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const match = HEX_COLOR_PATTERN.exec(value);
  if (!match) return null;
  const hex = match[1] as string;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 상대 휘도. 0(검정)~1(흰색). */
export function relativeLuminance(color: string): number | null {
  const rgb = parseHexColor(color);
  if (!rgb) return null;
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

export function contrastRatio(foreground: string, background: string): number | null {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  if (a === null || b === null) return null;
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export const ACCENT_TEXT_DARK = '#23201D';
export const ACCENT_TEXT_LIGHT = '#FFFFFF';

/**
 * 포인트 색상 위에 올릴 글자색을 고른다.
 * DESIGN.md 4.1: 포인트 색상을 바꿔도 본문 대비를 유지하고, 밝은 포인트에는 어두운 글자를 쓴다.
 */
export function accentContrastColor(accent: string): string {
  const dark = contrastRatio(ACCENT_TEXT_DARK, accent);
  const light = contrastRatio(ACCENT_TEXT_LIGHT, accent);
  if (dark === null || light === null) return ACCENT_TEXT_LIGHT;
  return dark >= light ? ACCENT_TEXT_DARK : ACCENT_TEXT_LIGHT;
}

/** 배경 위 옅은 강조 면에 쓰는 반투명 포인트 색. */
export function accentSoftColor(accent: string): string {
  const rgb = parseHexColor(accent);
  if (!rgb) return 'rgba(139, 67, 90, 0.12)';
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`;
}

/** 테마·포인트 색상을 CSS 변수 묶음으로 바꾼다. 미리보기와 저장 상태 모두 같은 함수를 쓴다. */
export function themeCssVariables(
  themeKey: ThemeKey,
  accentColor: string,
): Record<string, string> {
  const accent = isHexColor(accentColor) ? accentColor : DEFAULT_ACCENT_COLOR;
  return {
    '--color-accent': accent,
    '--color-accent-contrast': accentContrastColor(accent),
    '--color-accent-soft': accentSoftColor(accent),
    '--cover-gradient': THEME_PRESETS[themeKey].coverGradient,
  };
}
