import { DISPLAY_TIME_ZONE } from '@/lib/contracts';

import { listSpaceInvites, type InviteSummary } from '../queries';

import { SignOutButton } from './LiveAppShell';
import { InviteCreateForm, ProfileForm, RevokeInviteForm, SpaceForm } from './SettingsForms';

import type { MemberContext } from '../guards';

const STATUS_LABELS: Record<InviteSummary['status'], string> = {
  active: '사용 대기',
  accepted: '수락됨',
  revoked: '폐기됨',
  expired: '만료됨',
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: DISPLAY_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/**
 * 설정 화면.
 *
 * 이번 범위는 내 프로필, 공유 공간 정보, 구성원 확인, 초대 만들기·폐기, 로그아웃이다.
 * 공간 탈퇴·구성원 교체·공간 삭제는 MVP에서 제공하지 않는다(DESIGN.md 1).
 */
export async function SettingsPanel({ context }: { context: MemberContext }) {
  const { space, members, profile, user } = context;
  const invites = await listSpaceInvites();
  const canInvite = members.length < 2;
  const activeInvites = invites.filter((invite) => invite.status === 'active');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-text sm:text-2xl">설정</h1>
        <p className="mt-1 text-sm text-muted">
          {user.email ? `${user.email} 계정으로 로그인했습니다.` : '로그인했습니다.'}
        </p>
      </header>

      <ProfileForm
        initialNickname={profile?.nickname ?? ''}
        expectedVersion={profile?.version ?? 0}
      />

      <SpaceForm
        initialName={space.name}
        initialIntroduction={space.introduction}
        initialStartDate={space.relationshipStartDate ?? ''}
        expectedVersion={space.version}
      />

      <section className="app-card px-5 py-5 sm:px-6">
        <h2 className="text-sm font-bold text-text">구성원</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          공간에는 최대 두 명이 참여합니다. 구성원 교체·탈퇴는 아직 제공하지 않습니다.
        </p>
        <ul className="mt-3 space-y-2">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 text-sm text-text">
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold"
              >
                {(member.nickname ?? '?').slice(0, 1)}
              </span>
              <span>
                {member.nickname ?? '닉네임 없음'}
                {member.isSelf ? <span className="ml-2 chip">나</span> : null}
              </span>
              <span className="ml-auto text-xs text-muted">
                {formatDateTime(member.joinedAt)} 참여
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="app-card px-5 py-5 sm:px-6">
        <h2 className="text-sm font-bold text-text">초대</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          상대방 이메일로 일회용 초대 링크를 만듭니다. 링크는 24시간 뒤 만료되고 한 번만 쓸 수
          있습니다. 초대 주소는 서버 로그에 남지 않고 이 화면에서만 볼 수 있어요.
        </p>

        <div className="mt-4">
          <InviteCreateForm canInvite={canInvite} />
        </div>

        <h3 className="mt-6 text-xs font-bold text-text">보낸 초대</h3>
        {invites.length === 0 ? (
          <p className="mt-2 text-xs text-muted">아직 만든 초대가 없습니다.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {invites.map((invite) => (
              <li key={invite.inviteId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <span className="font-mono text-xs text-text">{invite.targetEmailMasked}</span>
                <span className="chip">{STATUS_LABELS[invite.status]}</span>
                <span className="text-xs text-muted">
                  {invite.status === 'accepted' && invite.acceptedAt
                    ? `${formatDateTime(invite.acceptedAt)} 수락`
                    : `${formatDateTime(invite.expiresAt)} 만료`}
                </span>
                {invite.status === 'active' ? (
                  <span className="ml-auto">
                    <RevokeInviteForm inviteId={invite.inviteId} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {activeInvites.length > 1 ? (
          <p className="mt-3 text-xs text-muted">
            새 초대를 만들면 이전 활성 초대는 자동으로 폐기됩니다.
          </p>
        ) : null}
      </section>

      <section className="app-card px-5 py-5 sm:px-6">
        <h2 className="text-sm font-bold text-text">로그아웃</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          이 브라우저의 로그인만 해제합니다. 다른 기기의 로그인은 유지됩니다.
        </p>
        <div className="mt-3">
          <SignOutButton className="btn-secondary" />
        </div>
      </section>
    </div>
  );
}
