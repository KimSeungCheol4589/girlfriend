'use client';

import type { ReactNode } from 'react';

import { AppShell } from '@/components/AppShell';
import { DemoModeBanner } from '@/components/DemoModeBanner';
import { DemoStoreProvider, useDemoStore } from '@/lib/demo/demo-store';

/**
 * 데모 모드 전용 껍데기.
 *
 * 데모 저장소는 **여기에서만** 마운트된다. 실제(live) 모드의 트리에는 들어가지 않으므로
 * 데모 데이터가 로그인한 화면에 섞일 수 없다.
 */
function DemoShellInner({ children }: { children: ReactNode }) {
  const { state } = useDemoStore();

  return (
    <AppShell
      spaceName={state.space.name}
      themeKey={state.customization.themeKey}
      accentColor={state.customization.accentColor}
      banner={<DemoModeBanner />}
    >
      {children}
    </AppShell>
  );
}

export function DemoShell({ children }: { children: ReactNode }) {
  return (
    <DemoStoreProvider>
      <DemoShellInner>{children}</DemoShellInner>
    </DemoStoreProvider>
  );
}
