import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { readSupabaseConfig } from './config';

/**
 * 요청마다 Auth 토큰을 갱신하고 갱신된 쿠키를 요청·응답 양쪽에 싣는다.
 *
 * 왜 필요한가: Server Component는 쿠키를 쓸 수 없다. 미들웨어가 갱신 쿠키를 응답에 싣지 않으면
 * 만료된 토큰을 든 사용자가 매 요청마다 로그아웃된 것처럼 보인다.
 *
 * 이 함수는 **접근 권한을 판단하지 않는다.** 화면·서버 작업이 각각 서버에서 사용자를 다시 확인한다.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const configResult = readSupabaseConfig();
  if (!configResult.ok) {
    // 설정이 없으면 세션을 만들지 않는다. 로그인 성공처럼 보이는 상태를 만들지 않는다.
    return response;
  }

  const supabase = createServerClient(configResult.config.url, configResult.config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // 토큰 갱신을 유발한다. 결과(사용자 여부)는 여기서 쓰지 않는다.
  await supabase.auth.getUser();

  return response;
}
