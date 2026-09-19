import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { requireSupabaseConfig } from './config';

/**
 * 서버(Server Component / Server Action / Route Handler)용 Supabase 클라이언트.
 *
 * - 세션은 쿠키에 있고, 요청마다 새 클라이언트를 만든다. 요청 사이에 재사용하면
 *   다른 사용자의 세션이 섞인다(DESIGN.md 9의 캐시 재사용 금지와 같은 이유).
 * - Server Component에서는 쿠키를 쓸 수 없다. 그 경우 조용히 무시하고,
 *   실제 갱신 쿠키는 미들웨어(`updateSession`)가 응답에 싣는다.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = requireSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component에서 호출된 경우. 미들웨어가 같은 갱신을 응답에 싣는다.
        }
      },
    },
  });
}

/**
 * 서버가 검증한 사용자.
 *
 * `getSession()`은 쿠키의 값을 그대로 돌려주므로 서버 권한 판단에 쓰지 않는다.
 * `getUser()`는 Auth 서버에 토큰을 확인한다(공식 문서의 서버 측 권장 경로).
 */
export async function getVerifiedUser(client: SupabaseClient): Promise<User | null> {
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}
