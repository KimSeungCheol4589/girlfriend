import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';

import { getAppMode } from '@/features/auth/mode';
import { safeNextPath } from '@/features/auth/redirects';
import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * PKCE 인증 콜백.
 *
 * Supabase가 보낸 메일 링크는 `?code=...`를 달고 이 경로로 돌아온다.
 * 코드를 세션으로 바꾸고 **허용된 내부 경로로만** 이동한다(열린 리다이렉트 방지).
 *
 * 실패 사유는 쿼리로 자세히 흘리지 않는다. 토큰·코드는 로그에 남기지 않는다.
 *
 * **이동은 상대 경로로만 한다.** 절대 주소를 `request.url`에서 만들면 요청 host와 달라질 수 있고
 * (개발 서버에서 `127.0.0.1` 요청이 `localhost`로 나갔다), 그러면 방금 심은 세션 쿠키가
 * 다른 host로 전달돼 사라진다. `/auth/confirm`도 같은 이유로 상대 경로를 쓴다.
 */
export async function GET(request: NextRequest): Promise<never> {
  const url = new URL(request.url);

  if (getAppMode() !== 'live') redirect('/login');

  const next = safeNextPath(url.searchParams.get('next'));

  // 공급자가 오류를 붙여 보낸 경우. 상세 문구는 그대로 노출하지 않는다.
  if (url.searchParams.get('error')) redirect('/login?authError=link');

  const code = url.searchParams.get('code');
  if (!code) redirect('/login?authError=link');

  let failurePath: string | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error(`auth.callback code=${error.code ?? error.status ?? 'exchange_failed'}`);
      failurePath = '/login?authError=link';
    }
  } catch (error) {
    if (isSupabaseConfigError(error)) {
      failurePath = '/login?authError=config';
    } else {
      throw error;
    }
  }

  // redirect()는 예외를 던지므로 try 밖에서 호출한다.
  redirect(failurePath ?? next);
}
