import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthPageShell, DemoModeAuthNotice } from '@/features/auth/components/AuthPageShell';
import { CreateSpaceForm } from '@/features/auth/components/CreateSpaceForm';
import { SignOutButton } from '@/features/auth/components/LiveAppShell';
import { SetupRequired } from '@/features/auth/components/SetupRequired';
import { getAppMode } from '@/features/auth/mode';
import { getSessionContext } from '@/features/auth/queries';

export const metadata: Metadata = {
  title: '공간 만들기',
};

export const dynamic = 'force-dynamic';

/**
 * 첫 공간 만들기.
 *
 * 운영자가 허용한 계정만 공간을 만들 수 있다. 두 번째 사람은 초대 링크로 들어온다
 * (DESIGN.md 1·8.1). 무제한 공개 가입·공간 생성은 제공하지 않는다.
 */
export default async function OnboardingPage() {
  if (getAppMode() === 'demo') return <DemoModeAuthNotice title="공간 만들기" />;

  const context = await getSessionContext();
  if (context.status === 'unconfigured') return <SetupRequired problems={context.problems} />;
  if (context.status === 'anonymous') redirect('/login?next=%2Fonboarding');
  if (context.status === 'member') redirect('/');

  return (
    <AuthPageShell
      title="우리 공간 만들기"
      description="아직 참여한 공간이 없습니다. 운영자가 허용한 계정이라면 여기서 첫 공간을 만들 수 있어요."
      footer={
        <span className="flex flex-wrap items-center justify-center gap-2">
          <span>다른 계정으로 들어왔나요?</span>
          <SignOutButton className="btn-quiet !min-h-[32px] !px-2 text-xs" />
        </span>
      }
    >
      <CreateSpaceForm />

      <div className="mt-6 rounded-xl bg-surface-muted px-4 py-3 text-xs leading-relaxed text-muted">
        <p className="font-semibold text-text">초대를 받았다면</p>
        <p className="mt-1">
          상대방이 보낸 초대 링크를 이 브라우저에서 열면 바로 그 공간에 참여합니다. 링크가 없거나
          만료됐다면 새 링크를 요청해 주세요.
        </p>
        <Link href="/invite" className="mt-2 inline-block text-accent underline-offset-4 hover:underline">
          초대 링크 확인하기
        </Link>
      </div>
    </AuthPageShell>
  );
}
