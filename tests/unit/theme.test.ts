import { describe, expect, it } from 'vitest';

import {
  ACCENT_TEXT_DARK,
  ACCENT_TEXT_LIGHT,
  accentContrastColor,
  contrastRatio,
  isHexColor,
  isThemeKey,
  parseHexColor,
  themeCssVariables,
} from '@/lib/theme';
import { THEME_KEYS } from '@/lib/contracts';

describe('isThemeKey', () => {
  it('설계에 정의한 3종만 통과한다', () => {
    for (const key of THEME_KEYS) {
      expect(isThemeKey(key)).toBe(true);
    }
    expect(isThemeKey('midnight')).toBe(false);
    expect(isThemeKey('')).toBe(false);
  });
});

describe('isHexColor / parseHexColor', () => {
  it('#RRGGBB만 받는다', () => {
    expect(isHexColor('#8B435A')).toBe(true);
    expect(isHexColor('#8b435a')).toBe(true);
    expect(isHexColor('#8B435')).toBe(false);
    expect(isHexColor('8B435A')).toBe(false);
    expect(isHexColor('#8B435AA')).toBe(false);
    expect(isHexColor('rgb(0,0,0)')).toBe(false);
  });

  it('채널 값을 0~255로 나눈다', () => {
    expect(parseHexColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexColor('#8B435A')).toEqual({ r: 139, g: 67, b: 90 });
    expect(parseHexColor('nope')).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('흑백 대비는 21:1이다', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('같은 색끼리는 1:1이다', () => {
    expect(contrastRatio('#8B435A', '#8B435A')).toBeCloseTo(1, 5);
  });

  it('형식이 잘못되면 null이다', () => {
    expect(contrastRatio('#000000', 'red')).toBeNull();
  });
});

describe('accentContrastColor', () => {
  it('밝은 포인트 색에는 어두운 글자를 고른다', () => {
    expect(accentContrastColor('#FFFFFF')).toBe(ACCENT_TEXT_DARK);
    expect(accentContrastColor('#F5D6A7')).toBe(ACCENT_TEXT_DARK);
  });

  it('어두운 포인트 색에는 밝은 글자를 고른다', () => {
    expect(accentContrastColor('#000000')).toBe(ACCENT_TEXT_LIGHT);
    expect(accentContrastColor('#8B435A')).toBe(ACCENT_TEXT_LIGHT);
  });

  it('중간 밝기 색에서는 대비가 더 높은 쪽을 고른다', () => {
    // 세이지(#6F8F72)는 흰 글자 대비 약 3.6:1, 어두운 글자 대비 약 4.5:1이다.
    expect(accentContrastColor('#6F8F72')).toBe(ACCENT_TEXT_DARK);
  });

  it('고른 글자색은 언제나 더 높은 대비를 준다', () => {
    for (const accent of ['#8B435A', '#C06C82', '#6F8F72', '#F5D6A7', '#123456', '#EEEEEE']) {
      const chosen = accentContrastColor(accent);
      const other = chosen === ACCENT_TEXT_DARK ? ACCENT_TEXT_LIGHT : ACCENT_TEXT_DARK;
      const chosenRatio = contrastRatio(chosen, accent);
      const otherRatio = contrastRatio(other, accent);
      expect(chosenRatio).not.toBeNull();
      expect(otherRatio).not.toBeNull();
      expect(chosenRatio as number).toBeGreaterThanOrEqual(otherRatio as number);
    }
  });

  it('형식이 잘못되면 기본값을 돌려준다', () => {
    expect(accentContrastColor('nope')).toBe(ACCENT_TEXT_LIGHT);
  });
});

describe('themeCssVariables', () => {
  it('테마별 커버 그라데이션과 포인트 변수를 만든다', () => {
    const variables = themeCssVariables('sage', '#6F8F72');
    expect(variables['--color-accent']).toBe('#6F8F72');
    // 중간 밝기의 세이지 위에서는 어두운 글자의 대비가 더 높다.
    expect(variables['--color-accent-contrast']).toBe(ACCENT_TEXT_DARK);
    expect(variables['--color-accent-soft']).toBe('rgba(111, 143, 114, 0.12)');
    expect(variables['--cover-gradient']).toContain('linear-gradient');
  });

  it('잘못된 포인트 색은 기본값으로 대체한다', () => {
    expect(themeCssVariables('cream', 'not-a-color')['--color-accent']).toBe('#8B435A');
  });

  it('테마마다 커버 배경이 다르다', () => {
    const covers = THEME_KEYS.map((key) => themeCssVariables(key, '#8B435A')['--cover-gradient']);
    expect(new Set(covers).size).toBe(THEME_KEYS.length);
  });
});
