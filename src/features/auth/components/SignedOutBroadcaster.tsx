'use client';

import { useEffect } from 'react';

import { clearInviteToken, getTabStorage } from '../invite-token';
import { broadcastSignedOut } from '../session-channel';

/**
 * 로그아웃이 **끝난 뒤** 로그인 화면에서 한 번 실행된다.
 *
 * - 이 탭에 남아 있던 초대 토큰을 지운다.
 * - 같은 브라우저의 다른 탭에 로그아웃을 알린다(비밀 없는 신호).
 *
 * 서버 액션이 세션을 지우고 `/login?signedOut=1`로 보낸 뒤에만 그려지므로,
 * "로그아웃이 실제로 성공했다"는 사실이 이미 확인된 시점이다.
 */
export function SignedOutBroadcaster() {
  useEffect(() => {
    clearInviteToken(getTabStorage());
    broadcastSignedOut();
  }, []);

  return null;
}
