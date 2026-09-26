import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getSessionContext } from '@/features/auth/queries';
import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import { memoryFailure, type MemoryActionFailure } from '../live/errors';

/**
 * 변경 Server Action의 공통 진입 검사.
 *
 * 매 호출마다 서버가 세션과 공간 소속을 다시 확인한다(`getSessionContext` → Auth `getUser`).
 * 클라이언트가 보낸 사용자·공간 ID는 받지 않는다.
 *
 * 이 모듈은 `'use server'` 파일이 아니다. 서버 액션 파일에서 헬퍼를 export하면 그 헬퍼까지
 * 외부 호출 가능한 endpoint가 되므로, 추억·연결 액션이 함께 쓰는 이 검사는 별 모듈에 둔다.
 */

export type MemberSession = {
  /** 사용자 세션 클라이언트. RLS와 전용 RPC만 쓴다(service_role 아님). */
  client: SupabaseClient;
  userId: string;
  spaceId: string;
};

export async function requireMemberSession(): Promise<
  { ok: true; member: MemberSession } | MemoryActionFailure
> {
  const context = await getSessionContext();
  if (context.status === 'unconfigured') return memoryFailure('CONFIG_ERROR');
  if (context.status === 'anonymous') return memoryFailure('UNAUTHENTICATED');
  if (context.status === 'no_space') return memoryFailure('NOT_FOUND');

  let client: SupabaseClient;
  try {
    client = await createSupabaseServerClient();
  } catch (error) {
    if (isSupabaseConfigError(error)) return memoryFailure('CONFIG_ERROR');
    throw error;
  }
  return { ok: true, member: { client, userId: context.user.id, spaceId: context.space.id } };
}
