import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';

import { getAppMode } from '@/features/auth/mode';
import { authLinkFailurePath, safeNextPath } from '@/features/auth/redirects';
import { isSupabaseConfigError } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * 토큰 해시 확인 콜백.
 *
 * 메일 템플릿이 `{{ .TokenHash }}`를 쓰는 경우 링크가 `?token_hash=...&type=...`로 돌아온다.
 * 확인에 성공하면 세션 쿠키가 만들어지고 허용된 내부 경로로만 이동한다.
 *
 * 토큰 해시는 이 요청에서만 쓰고 로그·리다이렉트 주소에 남기지 않는다.
 *
 * **이동은 상대 경로로만 한다.** `request.url`의 host로 절대 주소를 만들면 요청 host와
 * 달라질 수 있고(개발 서버에서 `127.0.0.1` 요청이 `localhost`로 나갔다),
 * 그 순간 방금 심은 세션 쿠키가 다른 host로 전달돼 사라진다.
 * `redirect()`는 받은 문자열을 그대로 `Location`에 넣으므로 브라우저가 현재 출처를 기준으로 푼다.
 * 또한 Next가 이 응답에 쿠키 변경분을 함께 실어 준다.
 */
const ALLOWED_TYPES = new Set<EmailOtpType>([
  'recovery',
  'email',
  'email_change',
  'invite',
  'magiclink',
  'signup',
]);

export async function GET(request: NextRequest): Promise<never> {
  const url = new URL(request.url);

  if (getAppMode() !== 'live') redirect('/login');

  const tokenHash = url.searchParams.get('token_hash');
  const rawType = url.searchParams.get('type') ?? '';
  const type = rawType as EmailOtpType;
  const next = safeNextPath(url.searchParams.get('next'));

  if (!tokenHash || !ALLOWED_TYPES.has(type)) {
    redirect(authLinkFailurePath(rawType));
  }

  let failurePath: string | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      console.error(`auth.confirm code=${error.code ?? error.status ?? 'verify_failed'}`);
      failurePath = authLinkFailurePath(rawType);
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
