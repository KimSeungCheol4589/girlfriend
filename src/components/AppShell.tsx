'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps, ReactNode } from 'react';

import { APP_ROOT_ID } from '@/components/ConfirmDialog';
import { ThemeScope } from '@/components/ThemeScope';
import { useUnsavedGuardControls } from '@/components/UnsavedGuard';
import type { ThemeKey } from '@/lib/contracts';

/**
 * 앱이 그리는 이동 링크.
 * 현재 화면에 미저장 변경이 있으면 이동을 멈추고 확인 대화상자를 띄운다.
 */
function NavLink({ href, children, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const { requestNavigate } = useUnsavedGuardControls();

  return (
    <Link
      href={href}
      onClick={(event) => {
        if (requestNavigate(href)) event.preventDefault();
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}

type NavItem = {
  /** basePath를 붙이기 전의 경로. */
  path: string;
  label: string;
  icon: ReactNode;
};

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: 'h-5 w-5',
};

const NAV_ITEMS: NavItem[] = [
  {
    path: '/',
    label: '홈',
    icon: (
      <svg {...iconProps}>
        <path d="M4 10.5 12 4l8 6.5" />
        <path d="M6 9.8V20h12V9.8" />
      </svg>
    ),
  },
  {
    path: '/memories',
    label: '추억',
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <circle cx="8.8" cy="10" r="1.6" />
        <path d="m4 17 4.6-4.2L13 17" />
        <path d="m12.5 15 3-2.8L20 16.4" />
      </svg>
    ),
  },
  {
    path: '/restaurants',
    label: '맛집',
    icon: (
      <svg {...iconProps}>
        <path d="M7 3v8a2.5 2.5 0 0 0 5 0V3" />
        <path d="M9.5 11v10" />
        <path d="M17.5 3c-1.4 1.4-2 3.2-2 5.2 0 1.4.7 2.3 2 2.6V21" />
      </svg>
    ),
  },
  {
    path: '/customize',
    label: '꾸미기',
    icon: (
      <svg {...iconProps}>
        <path d="M12 3.5c-4.7 0-8.5 3.5-8.5 7.9 0 4.3 3.4 6.8 6.2 6.8 1.4 0 1.9-.8 1.9-1.6 0-1.3-1-1.5-1-2.6 0-.9.7-1.6 1.8-1.6h2.1c3 0 5-2 5-4.7 0-2.8-3-4.2-7.5-4.2Z" />
        <circle cx="8" cy="9.5" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="15.8" cy="9.8" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

function isActive(pathname: string, href: string, homeHref: string): boolean {
  if (href === homeHref) return pathname === homeHref;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type AppShellProps = {
  children: ReactNode;
  /** 헤더에 보여 줄 공간 이름. */
  spaceName: string;
  themeKey: ThemeKey;
  accentColor: string;
  /**
   * 메뉴 링크 앞에 붙는 경로. 실제 화면은 '', 데모 화면은 '/demo'다.
   * 같은 껍데기를 쓰되 두 모드의 URL이 섞이지 않게 한다.
   */
  basePath?: string;
  /** 데모 고지처럼 헤더 위에 붙는 띠. 실제 화면에서는 비운다. */
  banner?: ReactNode;
  /** 헤더 오른쪽에 추가로 넣을 요소(예: 로그아웃). */
  headerActions?: ReactNode;
};

export function AppShell({
  children,
  spaceName,
  themeKey,
  accentColor,
  basePath = '',
  banner = null,
  headerActions = null,
}: AppShellProps) {
  const pathname = usePathname();
  const homeHref = basePath === '' ? '/' : basePath;
  const settingsHref = `${basePath}/settings`;
  const navItems = NAV_ITEMS.map((item) => ({
    ...item,
    href: item.path === '/' ? homeHref : `${basePath}${item.path}`,
  }));

  return (
    // 확인 대화상자가 열리면 이 영역 전체를 inert로 비활성화한다.
    <div id={APP_ROOT_ID}>
      <ThemeScope themeKey={themeKey} accentColor={accentColor} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-pill focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-accent-contrast"
      >
        본문으로 건너뛰기
      </a>

      {banner}

      <header className="sticky top-0 z-30 border-b border-border bg-background-blur backdrop-blur">
        <div className="app-container flex min-h-touch items-center gap-4 py-2">
          <NavLink
            href={homeHref}
            className="tap-target -ml-2 shrink-0 rounded-pill px-2 text-base font-bold tracking-tight text-text"
          >
            {spaceName}
          </NavLink>

          <nav aria-label="주요 메뉴" className="ml-auto hidden md:block">
            <ul className="flex items-center gap-1">
              {navItems.map((item) => {
                const active = isActive(pathname, item.href, homeHref);
                return (
                  <li key={item.href}>
                    <NavLink
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={`tap-target gap-2 rounded-pill px-4 text-sm font-semibold transition-colors ${
                        active
                          ? 'bg-accent-soft text-text'
                          : 'text-muted hover:bg-surface-muted hover:text-text'
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </nav>

          <NavLink
            href={settingsHref}
            aria-current={isActive(pathname, settingsHref, homeHref) ? 'page' : undefined}
            className="tap-target ml-auto shrink-0 gap-2 rounded-pill px-3 text-sm font-semibold text-muted transition-colors hover:bg-surface-muted hover:text-text md:ml-0"
          >
            <svg {...iconProps}>
              <circle cx="12" cy="12" r="3.2" />
              <path d="M19.4 14.2a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
            </svg>
            <span className="hidden sm:inline">설정</span>
            <span className="sr-only sm:hidden">설정</span>
          </NavLink>

          {headerActions}
        </div>
      </header>

      <main id="main" className="app-container py-6 md:py-10">
        {children}
      </main>

      <nav
        aria-label="주요 메뉴"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-blur pb-[env(safe-area-inset-bottom,0px)] backdrop-blur md:hidden"
      >
        <ul className="mx-auto flex max-w-content">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href, homeHref);
            return (
              <li key={item.href} className="flex-1">
                <NavLink
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-touch w-full flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-semibold transition-colors ${
                    active ? 'text-accent' : 'text-muted'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
