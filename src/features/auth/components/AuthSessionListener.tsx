'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

import { clearInviteToken, getTabStorage } from '../invite-token';

/**
 * 다른 탭에서 로그아웃했을 때 이 탭이 이전 사용자의 화면을 계속 보여 주지 않게 한다.
 *
 * 로그아웃 신호를 받으면 보관한 초대 토큰을 지우고 서버 렌더를 다시 받는다.
 * 서버는 세션이 없으므로 로그인 화면으로 보낸다.
 */
export function AuthSessionListener() {
  const router = useRouter();

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    try {
      const client = getSupabaseBrowserClient();
      const { data } = client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          clearInviteToken(getTabStorage());
          router.refresh();
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // 설정이 없으면 브라우저 클라이언트를 만들지 않는다. 실제 모드에서만 동작한다.
    }

    return () => unsubscribe?.();
  }, [router]);

  return null;
}
