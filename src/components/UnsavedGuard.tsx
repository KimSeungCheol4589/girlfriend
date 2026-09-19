'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';

/**
 * 미저장 변경이 있을 때 앱 안의 이동을 확인받는다.
 *
 * DESIGN.md 4.2의 "미저장 상태에서 이동 시 확인한다"를 앱이 통제할 수 있는 범위에서 구현한다.
 * 앱이 그리는 Link 클릭은 여기서 막아 확인 대화상자를 띄운다.
 *
 * 한계: 브라우저의 뒤로/앞으로 가기 버튼과 주소 직접 입력은 막지 못한다.
 * Next.js App Router에 라우트 이동을 취소할 수 있는 API가 없고, popstate는 이미
 * 이동이 확정된 뒤에 전달되기 때문이다. 탭 닫기·새로고침은 각 화면의 beforeunload가 맡는다.
 */

export type UnsavedGuardConfig = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
};

type UnsavedGuardValue = {
  setGuard: (config: UnsavedGuardConfig | null) => void;
  /** 이동을 가로챘으면 true. 호출부는 기본 동작을 막아야 한다. */
  requestNavigate: (href: string) => boolean;
};

const UnsavedGuardContext = createContext<UnsavedGuardValue | null>(null);

export function UnsavedGuardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // 렌더를 유발하지 않도록 현재 가드는 ref에 둔다. 클릭 시점에만 읽는다.
  const guardRef = useRef<UnsavedGuardConfig | null>(null);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const [pending, setPending] = useState<{ href: string; config: UnsavedGuardConfig } | null>(null);

  const setGuard = useCallback((config: UnsavedGuardConfig | null) => {
    guardRef.current = config;
  }, []);

  const requestNavigate = useCallback((href: string) => {
    const guard = guardRef.current;
    if (!guard) return false;

    // 지금 보고 있는 경로로의 이동은 화면을 떠나지 않는다. 확인할 것이 없다.
    // 여기서 가로채면 확인 후에도 화면이 그대로 남아 가드 상태가 어긋난다.
    // 지금 보고 있는 경로로의 이동은 화면을 떠나지 않는다. 확인할 것이 없다.
    // 여기서 가로채면 확인 후에도 화면이 그대로 남아 가드 상태가 어긋난다.
    const targetPath = href.split('?')[0]?.split('#')[0] ?? href;
    if (targetPath === pathnameRef.current) return false;

    setPending({ href, config: guard });
    return true;
  }, []);

  const value = useMemo<UnsavedGuardValue>(
    () => ({ setGuard, requestNavigate }),
    [setGuard, requestNavigate],
  );

  return (
    <UnsavedGuardContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        tone="neutral"
        title={pending?.config.title ?? ''}
        description={pending?.config.description ?? ''}
        confirmLabel={pending?.config.confirmLabel ?? '나가기'}
        cancelLabel={pending?.config.cancelLabel ?? '계속 편집'}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const href = pending?.href;
          setPending(null);
          // 가드를 여기서 풀지 않는다.
          // 화면이 내려갈 때 useUnsavedGuard의 cleanup이 해제한다.
          // 전역으로 미리 풀면 이동이 실제로 일어나지 않았을 때 가드가 사라진 채 남는다.
          // router.push는 링크 가로채기를 거치지 않으므로 우회가 필요 없다.
          if (href) router.push(href);
        }}
      />
    </UnsavedGuardContext.Provider>
  );
}

export function useUnsavedGuardControls(): UnsavedGuardValue {
  const value = useContext(UnsavedGuardContext);
  if (!value) {
    throw new Error('UnsavedGuard는 UnsavedGuardProvider 안에서만 사용할 수 있습니다.');
  }
  return value;
}

/** 화면이 미저장 상태인 동안 가드를 등록한다. */
export function useUnsavedGuard(dirty: boolean, config: UnsavedGuardConfig): void {
  const { setGuard } = useUnsavedGuardControls();
  const { title, description, confirmLabel, cancelLabel } = config;

  useEffect(() => {
    setGuard(dirty ? { title, description, confirmLabel, cancelLabel } : null);
    return () => setGuard(null);
  }, [setGuard, dirty, title, description, confirmLabel, cancelLabel]);
}
