import type { ReactNode } from 'react';

import { AppShell } from '@/components/AppShell';
import { DEFAULT_ACCENT_COLOR, type ThemeKey } from '@/lib/contracts';
import { isHexColor, isThemeKey } from '@/lib/theme';

import { signOutAction } from '../actions';

import { AuthSessionListener } from './AuthSessionListener';

import type { SessionSettings } from '../queries';

/** 로그아웃. 자바스크립트 없이도 동작하도록 form + Server Action을 쓴다. */
export function SignOutButton({ className = 'btn-quiet !px-3 text-sm' }: { className?: string }) {
  return (
    <form action={signOutAction}>
      <button type="submit" className={className}>
        로그아웃
      </button>
    </form>
  );
}

/**
 * 로그인·공간 확인을 마친 화면의 껍데기.
 * 데모 저장소를 쓰지 않고 공간 설정에서 읽은 테마를 적용한다.
 */
export function LiveAppShell({
  spaceName,
  settings,
  children,
}: {
  spaceName: string;
  settings: SessionSettings | null;
  children: ReactNode;
}) {
  const themeKey: ThemeKey =
    settings && isThemeKey(settings.themeKey) ? settings.themeKey : 'cream';
  const accentColor =
    settings && isHexColor(settings.accentColor) ? settings.accentColor : DEFAULT_ACCENT_COLOR;

  return (
    <AppShell
      spaceName={spaceName}
      themeKey={themeKey}
      accentColor={accentColor}
      headerActions={<SignOutButton />}
    >
      <AuthSessionListener />
      {children}
    </AppShell>
  );
}
