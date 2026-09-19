import type { Metadata, Viewport } from 'next';

import './globals.css';

import { AppShell } from '@/components/AppShell';
import { UnsavedGuardProvider } from '@/components/UnsavedGuard';
import { DemoStoreProvider } from '@/lib/demo/demo-store';

export const metadata: Metadata = {
  title: {
    default: '둘이 쌓는 공간',
    template: '%s · 둘이 쌓는 공간',
  },
  description:
    '사진과 짧은 글로 두 사람의 기록을 남기는 비공개 홈페이지. 현재는 화면 확인용 데모 모드입니다.',
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
  return (
    <html lang="ko" data-theme="cream">
      <body className="min-h-dvh antialiased">
        <DemoStoreProvider>
          <UnsavedGuardProvider>
            <AppShell>{children}</AppShell>
          </UnsavedGuardProvider>
        </DemoStoreProvider>
      </body>
    </html>
  );
}
