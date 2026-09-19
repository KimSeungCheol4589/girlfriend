'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import { ErrorNotice } from '@/components/ErrorNotice';

import { acceptInviteAction } from '../actions';
import { idleFormState } from '../form-state';
import {
  clearInviteToken,
  getTabStorage,
  parseInviteTokenFromHash,
  recallInviteToken,
  rememberInviteToken,
} from '../invite-token';

import { FormFeedback, SubmitButton } from './FormFeedback';
import { useStableRequestId } from './use-stable-request-id';

type TokenState = 'checking' | 'ready' | 'missing';

/**
 * 초대 수락.
 *
 * 토큰 취급(DESIGN.md 8.1)
 *   - URL fragment에서만 읽고, 읽는 즉시 주소에서 지운다.
 *   - 로그인을 거쳐야 할 수 있으므로 그 탭의 sessionStorage에만 잠깐 둔다.
 *   - 수락 성공·무효·만료·로그아웃 시 지운다.
 *   - 화면·로그·서버 요청 쿼리에 토큰을 남기지 않는다. 폼 필드도 감춘다.
 */
export function InviteAcceptView({ authenticated }: { authenticated: boolean }) {
  const router = useRouter();
  const [state, formAction] = useActionState(acceptInviteAction, idleFormState);
  const [token, setToken] = useState<string | null>(null);
  const [tokenState, setTokenState] = useState<TokenState>('checking');

  // 요청 키는 토큰이 같은 동안 유지한다. 재시도해도 한 번만 반영된다.
  const requestId = useStableRequestId({ token: token ?? '' });

  useEffect(() => {
    const storage = getTabStorage();
    const fromHash = parseInviteTokenFromHash(window.location.hash);

    if (fromHash) {
      rememberInviteToken(storage, fromHash, Date.now());
      // 주소에서 토큰을 즉시 지운다. 히스토리·공유·리퍼러에 남지 않게 한다.
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      setToken(fromHash);
      setTokenState('ready');
      return;
    }

    const stored = recallInviteToken(storage, Date.now());
    setToken(stored);
    setTokenState(stored ? 'ready' : 'missing');
  }, []);

  // 수락에 성공하면 보관한 토큰을 지우고 홈으로 이동한다.
  useEffect(() => {
    if (state.status !== 'success') return;
    clearInviteToken(getTabStorage());
    setToken(null);
    const target = state.redirectTo ?? '/';
    router.replace(target);
    router.refresh();
  }, [state, router]);

  // 다시 쓸 수 없는 초대는 보관을 유지할 이유가 없다.
  useEffect(() => {
    if (state.status === 'error' && state.code === 'INVITE_INVALID') {
      clearInviteToken(getTabStorage());
    }
  }, [state]);

  if (tokenState === 'checking') {
    return <p className="text-sm text-muted">초대 링크를 확인하는 중입니다…</p>;
  }

  if (tokenState === 'missing' || !token) {
    return (
      <>
        <ErrorNotice
          title="초대 링크를 확인하지 못했어요"
          description="주소에 초대 정보가 없거나 보관 시간이 지났습니다. 초대 링크는 보안을 위해 짧게만 보관합니다."
        />
        <p className="mt-4 text-sm leading-relaxed text-muted">
          상대방에게 <strong className="font-semibold text-text">새 초대 링크</strong>를 만들어
          달라고 요청해 주세요. 새 초대를 만들면 이전 초대는 자동으로 폐기되고, 받은 링크를 이
          브라우저에서 바로 열면 됩니다.
        </p>
        <Link href="/login" className="btn-secondary mt-6">
          로그인 화면으로
        </Link>
      </>
    );
  }

  if (!authenticated) {
    return (
      <>
        <p className="text-sm leading-relaxed text-muted">
          초대 링크를 확인했습니다. 초대는 <strong className="font-semibold text-text">대상 이메일로
          로그인한 계정</strong>만 수락할 수 있어요. 로그인하면 이 화면으로 돌아옵니다.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          초대 정보는 이 탭에서만 잠시 보관하고, 수락하거나 시간이 지나면 지웁니다.
        </p>
        <Link href="/login?next=%2Finvite" className="btn-primary mt-6 w-full">
          로그인하고 계속하기
        </Link>
      </>
    );
  }

  return (
    <>
      <FormFeedback state={state} />

      <p className="text-sm leading-relaxed text-muted">
        초대를 수락하면 두 사람이 같은 공간의 기록을 함께 보고 편집합니다. 공간에는 최대 두 명만
        참여할 수 있어요.
      </p>

      <form action={formAction} className="mt-6">
        {/* 토큰은 화면에 보이지 않고 이 요청에만 실린다. */}
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="requestId" value={requestId} />
        <SubmitButton pendingLabel="수락하는 중…" className="btn-primary w-full">
          초대 수락하기
        </SubmitButton>
      </form>
    </>
  );
}
