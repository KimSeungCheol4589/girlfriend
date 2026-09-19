'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireSupabaseConfig } from './config';

/**
 * 브라우저 Supabase 클라이언트.
 *
 * 한 탭에서 여러 인스턴스를 만들면 세션 저장소를 각자 갱신해 토큰이 어긋난다.
 * 탭당 하나만 만들어 재사용한다.
 */
let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const { url, publishableKey } = requireSupabaseConfig();
  // 쿠키 저장은 @supabase/ssr가 처리한다. 서버·브라우저가 같은 쿠키를 읽는다.
  browserClient = createBrowserClient(url, publishableKey);
  return browserClient;
}
