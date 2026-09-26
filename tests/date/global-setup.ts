import type { FullConfig } from '@playwright/test';

/**
 * DATE-001 E2E 준비 — 개발 서버 라우트 예열.
 *
 * `next dev`는 경로마다 **처음 들어갈 때** 번들을 컴파일한다. 이 프로젝트에서는 `/login` 첫 요청이
 * 8초 넘게 걸렸고, 그 시간이 테스트의 단언 대기 시간 안에서 소모되면 "화면이 안 뜬다"는 형태의
 * 불안정한 실패로 보인다(앱 결함이 아니다).
 *
 * 그래서 테스트를 시작하기 전에 이 스위트가 쓰는 경로를 한 번씩 열어 컴파일을 끝내 둔다.
 * 응답 내용은 보지 않고 상태 코드만 확인하며, 실패해도 테스트를 막지 않는다(느린 환경에서 예열이
 * 실패했다고 스위트 전체를 중단시키지 않는다).
 */

const WARMUP_PATHS = ['/login', '/', '/wishes', '/calendar', '/memories', '/memories/new'];

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) return;

  for (const path of WARMUP_PATHS) {
    const started = Date.now();
    try {
      const response = await fetch(new URL(path, baseURL), {
        redirect: 'manual',
        signal: AbortSignal.timeout(120_000),
      });
      console.log(`예열 ${path} → HTTP ${response.status} (${Date.now() - started}ms)`);
    } catch {
      console.log(`예열 ${path} → 건너뜀 (${Date.now() - started}ms)`);
    }
  }
}
