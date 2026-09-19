import { redirect } from 'next/navigation';

import { getSessionContext, type SessionContext } from './queries';
import { parseSafeNextPath } from './redirects';

import type { SupabaseConfigProblem } from '@/lib/supabase/config';

export type MemberContext = Extract<SessionContext, { status: 'member' }>;
export type NoSpaceContext = Extract<SessionContext, { status: 'no_space' }>;

export type LivePageResult =
  | { kind: 'unconfigured'; problems: SupabaseConfigProblem[] }
  | { kind: 'member'; context: MemberContext };

/**
 * 로그인·공간 소속이 필요한 화면의 공통 진입 검사.
 *
 * - 설정 없음  → 화면이 "설정 필요"를 그린다(로그인 성공으로 대체하지 않는다).
 * - 비로그인   → `/login`으로 보낸다. 돌아올 경로는 허용 목록으로 제한한다.
 * - 공간 없음  → `/onboarding`으로 보낸다.
 *
 * 미들웨어가 아니라 **화면마다** 서버에서 다시 확인한다. route group 이름이나
 * 미들웨어 통과 여부는 접근 권한이 아니다(DESIGN.md 10).
 */
export async function requireMember(currentPath: string): Promise<LivePageResult> {
  const context = await getSessionContext();

  if (context.status === 'unconfigured') {
    return { kind: 'unconfigured', problems: context.problems };
  }
  if (context.status === 'anonymous') {
    const next = parseSafeNextPath(currentPath);
    redirect(next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login');
  }
  if (context.status === 'no_space') {
    redirect('/onboarding');
  }

  return { kind: 'member', context };
}
