import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ErrorNotice } from '@/components/ErrorNotice';
import { AuthPageShell, DemoModeAuthNotice } from '@/features/auth/components/AuthPageShell';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { SetupRequired } from '@/features/auth/components/SetupRequired';
import { SignedOutBroadcaster } from '@/features/auth/components/SignedOutBroadcaster';
import { getAppMode } from '@/features/auth/mode';
import { authErrorMessage, firstParam } from '@/features/auth/notices';
import { getSessionContext } from '@/features/auth/queries';
import { safeNextPath } from '@/features/auth/redirects';

export const metadata: Metadata = {
  title: '로그인',
};

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (getAppMode() === 'demo') return <DemoModeAuthNotice title="로그인" />;

  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));
  const context = await getSessionContext();

  if (context.status === 'unconfigured') return <SetupRequired problems={context.problems} />;
  // 이미 로그인한 사용자는 로그인 화면에 머무르지 않는다.
  if (context.status === 'member') redirect(next);
  if (context.status === 'no_space') redirect('/onboarding');

  const linkError = authErrorMessage(firstParam(params.authError));
  const signedOut = firstParam(params.signedOut) === '1';

  return (
    <AuthPageShell
      title="로그인"
      description="두 사람만 쓰는 비공개 공간입니다. 계정 이메일과 비밀번호로 로그인해 주세요."
      footer="이 화면에서 만든 세션은 이 브라우저에만 저장됩니다."
    >
      {linkError ? (
        <div className="mb-4">
          <ErrorNotice title="인증 링크를 사용할 수 없어요" description={linkError} />
        </div>
      ) : null}

      {/* 로그아웃이 끝난 뒤에만 이 탭 정리와 다른 탭 알림을 수행한다. */}
      {signedOut ? <SignedOutBroadcaster /> : null}

      <LoginForm next={next} signedOut={signedOut} />
    </AuthPageShell>
  );
}
