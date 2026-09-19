import type { Metadata } from 'next';

import { ErrorNotice } from '@/components/ErrorNotice';
import { AuthPageShell, DemoModeAuthNotice } from '@/features/auth/components/AuthPageShell';
import { NewPasswordForm, PasswordResetRequestForm } from '@/features/auth/components/PasswordForms';
import { SetupRequired } from '@/features/auth/components/SetupRequired';
import { getAppMode } from '@/features/auth/mode';
import { authErrorMessage, firstParam } from '@/features/auth/notices';
import { getSessionContext } from '@/features/auth/queries';

export const metadata: Metadata = {
  title: '비밀번호 재설정',
};

export const dynamic = 'force-dynamic';

/**
 * 하나의 화면에서 두 단계를 처리한다.
 *   - 로그인 세션이 없으면: 재설정 메일 요청
 *   - 메일 링크로 세션이 생겼으면: 새 비밀번호 설정
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (getAppMode() === 'demo') return <DemoModeAuthNotice title="비밀번호 재설정" />;

  const params = await searchParams;
  const context = await getSessionContext();

  if (context.status === 'unconfigured') return <SetupRequired problems={context.problems} />;

  const linkError = authErrorMessage(firstParam(params.authError));
  const hasSession = context.status !== 'anonymous';

  return (
    <AuthPageShell
      title={hasSession ? '새 비밀번호 설정' : '비밀번호 재설정'}
      description={
        hasSession
          ? '새 비밀번호를 정하면 이 브라우저의 로그인 상태가 유지됩니다.'
          : '가입한 이메일로 재설정 링크를 보냅니다. 계정이 있는지 여부는 알려 드리지 않습니다.'
      }
    >
      {linkError ? (
        <div className="mb-4">
          <ErrorNotice title="링크를 사용할 수 없어요" description={linkError} />
        </div>
      ) : null}

      {hasSession ? <NewPasswordForm /> : <PasswordResetRequestForm />}
    </AuthPageShell>
  );
}
