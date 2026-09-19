import type { Metadata, Viewport } from 'next';

import './globals.css';

import { DemoShell } from '@/components/DemoShell';
import { UnsavedGuardProvider } from '@/components/UnsavedGuard';
import { getAppMode } from '@/features/auth/mode';

export const metadata: Metadata = {
  title: {
    default: '둘이 쌓는 공간',
    template: '%s · 둘이 쌓는 공간',
  },
  description: '사진과 짧은 글로 두 사람의 기록을 남기는 비공개 홈페이지.',
  icons: { icon: '/icon.svg' },
  // 비공개 서비스이므로 검색 노출을 막는다.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FBF7F1',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = getAppMode();

  return (
    <html lang="ko" data-theme="cream">
      <body className="min-h-dvh antialiased">
        <UnsavedGuardProvider>
          {/*
            데모 저장소와 데모 껍데기는 데모 모드에서만 마운트한다.
            실제 모드의 화면은 각자 로그인·공간 확인을 마친 뒤 자신의 껍데기를 그린다.
          */}
          {mode === 'demo' ? <DemoShell>{children}</DemoShell> : children}
        </UnsavedGuardProvider>
      </body>
    </html>
  );
}
