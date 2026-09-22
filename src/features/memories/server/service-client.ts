import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { readSupabaseConfig } from '@/lib/supabase/config';

/**
 * 추억 사진 전용 신뢰 서버 클라이언트(service_role). docs/auth/SETUP.md 2.2의 예외.
 *
 * 요청 세션 클라이언트(`@/lib/supabase/server`)와 별개다. 세션 쿠키를 싣지 않고 세션을 저장·갱신하지 않는다.
 * 쓰는 곳은 두 가지뿐이다. 일반 조회·저장에는 절대 쓰지 않는다.
 *   1. 업로드 확정: 사용자 RLS로 자산 소유를 확인한 **뒤** 객체를 읽기 전용으로 내려받아 검증하고
 *      `finalize_upload`를 호출한다(로그인 사용자는 실행 권한이 없다). 객체를 쓰지 않는다.
 *   2. 파일 정리: DB가 `deleting`으로 바꾸고 응답에 실어 준 경로만 재확인 후 지운다.
 *
 * 키 이름: `MEM_SUPABASE_SERVICE_ROLE_KEY` (서버 전용). 값이 없으면 사진 기능만 꺼진다.
 * 키 값은 어떤 로그에도 남기지 않는다.
 */

export const SERVICE_KEY_ENV_NAME = 'MEM_SUPABASE_SERVICE_ROLE_KEY';

function readServiceKey(): string | null {
  const value = (process.env.MEM_SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (value.length < 20 || /\s/.test(value)) return null;
  return value;
}

/** 사진 확정·정리에 필요한 서버 자격 증명이 있는지. 값은 돌려주지 않는다. */
export function isPhotoPipelineConfigured(): boolean {
  return readServiceKey() !== null && readSupabaseConfig().ok;
}

/** 요청마다 새로 만든다. 설정이 없으면 null(호출자는 PHOTOS_DISABLED로 답한다). */
export function createServiceClient(): SupabaseClient | null {
  const key = readServiceKey();
  const config = readSupabaseConfig();
  if (!key || !config.ok) return null;

  return createClient(config.config.url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'memories-worker' } },
  });
}

/** 서버 전용 Storage 요청 주소·헤더. 키는 이 모듈 밖 로그로 나가지 않는다. */
export function serviceStorageRequest(path: string): { url: string; headers: Record<string, string> } | null {
  const key = readServiceKey();
  const config = readSupabaseConfig();
  if (!key || !config.ok) return null;
  return {
    url: `${config.config.url}/storage/v1/${path}`,
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  };
}
