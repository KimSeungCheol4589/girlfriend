'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

import { clearInviteToken, getTabStorage } from '../invite-token';
import { subscribeSignedOut } from '../session-channel';

/**
 * 다른 탭에서 로그아웃했을 때 이 탭이 이전 사용자의 화면을 계속 보여 주지 않게 한다.
 *
 * 두 가지 경로를 모두 듣는다.
 *   1. 같은 출처의 로그아웃 알림(`session-channel`). 로그아웃은 서버 액션이 쿠키를 지우는
 *      방식이라 이 알림이 없으면 다른 탭은 아무것도 모른다.
 *   2. 브라우저 클라이언트가 스스로 감지한 `SIGNED_OUT`(토큰 폐기 등).
 *
 * 알림을 받으면 보관한 초대 토큰을 지우고 서버 렌더를 다시 받는다.
 * 서버는 세션이 없으므로 로그인 화면으로 보낸다(접근 판단은 계속 서버가 한다).
 */
export function AuthSessionListener() {
  const router = useRouter();

  useEffect(() => {
    const handleSignedOut = () => {
      clearInviteToken(getTabStorage());
      router.refresh();
    };

    const unsubscribeChannel = subscribeSignedOut(handleSignedOut);
    let unsubscribe: (() => void) | null = null;

    try {
      const client = getSupabaseBrowserClient();
      const { data } = client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') handleSignedOut();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // 설정이 없으면 브라우저 클라이언트를 만들지 않는다. 실제 모드에서만 동작한다.
    }

    return () => {
      unsubscribeChannel();
      unsubscribe?.();
    };
  }, [router]);

  return null;
}
