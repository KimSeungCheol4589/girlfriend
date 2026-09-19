import { NextResponse, type NextRequest } from 'next/server';

import { getAppMode } from '@/features/auth/mode';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * 실제(live) 모드의 모든 요청에서 Auth 세션 쿠키를 갱신한다.
 *
 * - 데모 모드에서는 인증을 쓰지 않으므로 세션을 만들지도 갱신하지도 않는다.
 * - 인증이 붙는 응답은 공유 캐시에 저장하지 않는다(DESIGN.md 9).
 *   계정이 바뀌었을 때 이전 사용자의 화면이 재사용되는 것을 막는다.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (getAppMode() !== 'live') {
    return NextResponse.next();
  }

  const response = await updateSession(request);
  response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  return response;
}

export const config = {
  // 정적 파일과 이미지 최적화 경로는 제외한다.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|artwork/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
