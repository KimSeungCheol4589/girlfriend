'use client';

import { useEffect } from 'react';

import { themeCssVariables } from '@/lib/theme';
import type { ThemeKey } from '@/lib/contracts';

/**
 * 저장된(데모에서는 세션 메모리의) 테마를 문서 전체에 적용한다.
 * 꾸미기 화면의 미리보기는 이 컴포넌트를 쓰지 않고 미리보기 영역에만 변수를 씌운다.
 */
export function ThemeScope({
  themeKey,
  accentColor,
}: {
  themeKey: ThemeKey;
  accentColor: string;
}) {
  useEffect(() => {
    const root = document.documentElement;
    const variables = themeCssVariables(themeKey, accentColor);

    root.dataset.theme = themeKey;
    for (const [name, value] of Object.entries(variables)) {
      root.style.setProperty(name, value);
    }

    return () => {
      for (const name of Object.keys(variables)) {
        root.style.removeProperty(name);
      }
    };
  }, [themeKey, accentColor]);

  return null;
}
