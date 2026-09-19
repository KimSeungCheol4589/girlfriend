import { cache } from 'react';

import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';

import type { SupabaseConfigProblem } from '@/lib/supabase/config';

/**
 * 서버에서 확인한 세션·공간 상태.
 *
 * 화면은 이 결과만 보고 분기한다. 클라이언트가 보낸 값(userId·spaceId)은 쓰지 않는다.
 * 조회는 사용자 세션 + RLS로 수행한다. 서비스 키는 이 경로에 없다.
 */

export type SessionUser = {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
};

export type SessionProfile = {
  id: string;
  nickname: string;
  version: number;
};

export type SessionSpace = {
  id: string;
  name: string;
  introduction: string;
  relationshipStartDate: string | null;
  version: number;
};

export type SessionMember = {
  userId: string;
  nickname: string | null;
  joinedAt: string;
  isSelf: boolean;
};

export type SessionSettings = {
  themeKey: string;
  accentColor: string;
  version: number;
};

export type SessionContext =
  | { status: 'unconfigured'; problems: SupabaseConfigProblem[] }
  | { status: 'anonymous' }
  | { status: 'no_space'; user: SessionUser; profile: SessionProfile | null }
  | {
      status: 'member';
      user: SessionUser;
      profile: SessionProfile | null;
      space: SessionSpace;
      members: SessionMember[];
      settings: SessionSettings | null;
    };

type SpaceMemberRow = { space_id: string; user_id: string; joined_at: string };
type SpaceRow = {
  id: string;
  name: string;
  introduction: string | null;
  relationship_start_date: string | null;
  version: number;
};
type ProfileRow = { id: string; nickname: string; version: number };
type SettingsRow = { theme_key: string; accent_color: string; version: number };

/**
 * 한 요청 안에서는 같은 결과를 재사용한다(레이아웃과 페이지가 각각 호출한다).
 * `cache`는 요청 단위이므로 다른 사용자의 결과가 섞이지 않는다.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (isSupabaseConfigError(error)) {
      return { status: 'unconfigured', problems: error.problems };
    }
    throw error;
  }

  const authUser = await getVerifiedUser(supabase);
  if (!authUser) return { status: 'anonymous' };

  const user: SessionUser = {
    id: authUser.id,
    email: authUser.email ?? null,
    emailConfirmed: Boolean(authUser.email_confirmed_at),
  };

  const { data: memberRows } = await supabase
    .from('space_members')
    .select('space_id, user_id, joined_at');
  const members = (memberRows ?? []) as SpaceMemberRow[];

  const own = members.find((row) => row.user_id === user.id) ?? null;

  const { data: profileRows } = await supabase.from('profiles').select('id, nickname, version');
  const profiles = (profileRows ?? []) as ProfileRow[];
  const ownProfile = profiles.find((row) => row.id === user.id) ?? null;
  const profile: SessionProfile | null = ownProfile
    ? { id: ownProfile.id, nickname: ownProfile.nickname, version: ownProfile.version }
    : null;

  if (!own) {
    return { status: 'no_space', user, profile };
  }

  const { data: spaceRow } = await supabase
    .from('spaces')
    .select('id, name, introduction, relationship_start_date, version')
    .eq('id', own.space_id)
    .maybeSingle();

  if (!spaceRow) {
    // 소속 행은 보이는데 공간을 못 읽는 경우는 정책·데이터 불일치다.
    // 로그인 성공으로 대체하지 않고 공간 없음으로 다룬다.
    return { status: 'no_space', user, profile };
  }

  const space = spaceRow as SpaceRow;

  const { data: settingsRow } = await supabase
    .from('space_settings')
    .select('theme_key, accent_color, version')
    .eq('space_id', own.space_id)
    .maybeSingle();
  const settings = settingsRow as SettingsRow | null;

  const nicknameById = new Map(profiles.map((row) => [row.id, row.nickname]));

  return {
    status: 'member',
    user,
    profile,
    space: {
      id: space.id,
      name: space.name,
      introduction: space.introduction ?? '',
      relationshipStartDate: space.relationship_start_date,
      version: space.version,
    },
    members: members
      .slice()
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
      .map((row) => ({
        userId: row.user_id,
        nickname: nicknameById.get(row.user_id) ?? null,
        joinedAt: row.joined_at,
        isSelf: row.user_id === user.id,
      })),
    settings: settings
      ? {
          themeKey: settings.theme_key,
          accentColor: settings.accent_color,
          version: settings.version,
        }
      : null,
  };
});

export type InviteSummary = {
  inviteId: string;
  targetEmailMasked: string;
  status: 'active' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
};

/**
 * 초대 상태 목록.
 * `space_invites`에는 SELECT 권한이 없으므로 전용 함수로만 읽는다(CONTRACTS.md 1).
 * 토큰 원문·해시·전체 이메일은 반환되지 않는다.
 */
export async function listSpaceInvites(): Promise<InviteSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('list_space_invites');
  if (error || !data) return [];

  const rows = data as {
    invite_id: string;
    target_email_masked: string;
    status: string;
    expires_at: string;
    created_at: string;
    accepted_at: string | null;
  }[];

  return rows.map((row) => ({
    inviteId: row.invite_id,
    targetEmailMasked: row.target_email_masked,
    status: (['active', 'accepted', 'revoked', 'expired'] as const).includes(
      row.status as InviteSummary['status'],
    )
      ? (row.status as InviteSummary['status'])
      : 'expired',
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  }));
}
