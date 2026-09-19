import type { Metadata } from 'next';

import { AuthPageShell, DemoModeAuthNotice } from '@/features/auth/components/AuthPageShell';
import { InviteAcceptView } from '@/features/auth/components/InviteAcceptView';
import { SetupRequired } from '@/features/auth/components/SetupRequired';
import { getAppMode } from '@/features/auth/mode';
import { getSessionContext } from '@/features/auth/queries';

export const metadata: Metadata = {
  title: '초대 수락',
};

export const dynamic = 'force-dynamic';

/**
 * 초대 수락 화면.
 *
 * 토큰은 URL fragment에 있으므로 서버로 전달되지 않는다. 비로그인이어도 이 화면을 먼저
 * 그려야 브라우저가 fragment를 읽어 보관할 수 있다. 그래서 바로 로그인으로 보내지 않는다.
 */
export default async function InvitePage() {
  if (getAppMode() === 'demo') return <DemoModeAuthNotice title="초대 수락" />;

  const context = await getSessionContext();
  if (context.status === 'unconfigured') return <SetupRequired problems={context.problems} />;

  const authenticated = context.status !== 'anonymous';
  const alreadyMember = context.status === 'member';

  return (
    <AuthPageShell
      title="초대 수락"
      description="상대방이 보낸 일회용 초대 링크로 같은 공간에 참여합니다."
      footer="초대 링크는 24시간 뒤 만료되고 한 번만 쓸 수 있습니다."
    >
      {alreadyMember ? (
        <p className="mb-4 rounded-xl bg-surface-muted px-4 py-3 text-xs leading-relaxed text-muted">
          이미 공간에 참여해 있습니다. 한 계정은 공간 하나에만 참여할 수 있어요. 다른 공간의 초대는
          수락할 수 없습니다.
        </p>
      ) : null}

      <InviteAcceptView authenticated={authenticated} />
    </AuthPageShell>
  );
}
