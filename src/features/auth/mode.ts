/**
 * 앱 동작 모드. 한 번에 하나만 활성화된다.
 *
 * | 모드           | 언제                                          | 화면 |
 * | -------------- | --------------------------------------------- | ---- |
 * | `demo`         | `NEXT_PUBLIC_DEMO_MODE=true` (**명시적 진입만**) | 브라우저 메모리만 쓰는 데모. 로그인·서버 저장 없음 |
 * | `live`         | Supabase 설정이 있고 데모를 켜지 않았을 때    | 실제 로그인·공간·초대 |
 * | `unconfigured` | 그 밖의 모든 경우(설정 없음 + 데모 미지정)    | "설정 필요" 안내. 로그인 성공처럼 보이는 대체 동작 없음 |
 *
 * 규칙
 *   - `live`에서는 데모 저장소를 **마운트하지 않는다.** 데모 데이터가 실제 화면에 섞일 수 없다.
 *   - `demo`에서는 인증 화면도 "데모 모드"라고 밝히고 로그인 시늉을 하지 않는다.
 *   - 설정이 없으면 실패한다. 인증 성공으로 대체하지 않는다.
 */

import { isSupabaseConfigured } from '@/lib/supabase/config';

export type AppMode = 'demo' | 'live' | 'unconfigured';

export function resolveAppMode(input: { configured: boolean; demoFlag: string | undefined }): AppMode {
  const flag = (input.demoFlag ?? '').trim().toLowerCase();
  const explicitOn = flag === 'true' || flag === '1';

  // 데모는 **명시적으로 켰을 때만** 동작한다. 설정이 없다고 해서 자동으로 데모가 되지 않는다.
  // 설정 누락은 조용히 데모로 흘러가지 않고 "설정 필요"로 분명히 실패해야 한다.
  if (explicitOn) return 'demo';
  return input.configured ? 'live' : 'unconfigured';
}

export function getAppMode(): AppMode {
  return resolveAppMode({
    configured: isSupabaseConfigured(),
    demoFlag: process.env.NEXT_PUBLIC_DEMO_MODE,
  });
}

export function isDemoMode(): boolean {
  return getAppMode() === 'demo';
}

export function isLiveMode(): boolean {
  return getAppMode() === 'live';
}
