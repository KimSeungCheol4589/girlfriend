import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { buildWebServerEnv } from '../auth/web-server-env';

/**
 * CAL-001 실제 인증 E2E 설정(로컬 Supabase 전용).
 *
 * - 루트 공통 설정(playwright.config.ts, playwright.auth.config.ts)은 바꾸지 않고 이 파일만 쓴다.
 * - 앱 서버는 127.0.0.1:3007에만 바인딩한다(통합 3000, 데모 3001, 인증 3002, MEM 3003, FOOD 3004,
 *   WISH 3006과 분리).
 * - 앱 서버 환경에서 `*SERVICE_ROLE*` 키를 빈 값으로 덮어쓴다(`tests/auth/web-server-env.ts`, 읽기 전용 재사용).
 *   러너·스펙은 자기 환경에서 공개 키로 직접 API를 호출한다. 관리자 키는 스펙에서 쓰지 않는다.
 * - 실패 산출물의 페이지 스냅샷(입력값 포함)은 인증 스위트의 리포터로 지운다.
 * - trace·video·screenshot은 끈다(세션 쿠키·입력값이 남는다).
 *
 * 준비: `node tests/calendar/fixtures/cli.mjs setup`
 * 실행: `node node_modules/@playwright/test/cli.js test --config tests/calendar/playwright.config.ts`
 */

const REPO_ROOT = resolve(__dirname, '..', '..');
// 포트 배정(총괄): 통합 3000, 데모 3001, 인증 3002, MEM 3003, FOOD 3004, WISH 3006, CAL 3007.
const PORT = Number(process.env.CAL_E2E_PORT ?? 3007);
const HOST = '127.0.0.1';
const baseURL = `http://${HOST}:${PORT}`;

const supabaseUrl = (
  process.env.AUTH_TEST_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  ''
).trim();
const supabaseKey = (
  process.env.AUTH_TEST_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  ''
).trim();

if (supabaseUrl === '' || supabaseKey === '') {
  throw new Error(
    'CAL-001 E2E에는 로컬 Supabase 주소와 공개 키가 필요합니다. ' +
      'AUTH_TEST_SUPABASE_URL / AUTH_TEST_ANON_KEY를 설정하세요(값은 출력하지 않습니다).',
  );
}
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(supabaseUrl).hostname)) {
  throw new Error('CAL-001 E2E는 로컬(loopback) Supabase에서만 실행합니다.');
}

export default defineConfig({
  testDir: './e2e',
  // 같은 계정·공간을 쓰므로 순서대로 실행한다.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], [resolve(REPO_ROOT, 'tests/auth/reporters/redact-error-context.ts')]],
  // 산출물을 `.agent-runtime/` 아래에 둔다(Git 제외). 저장소 안(`test-results/`)에 쓰면
  // `next dev`의 파일 감시가 그 쓰기를 보고 Fast Refresh를 일으켜, 테스트 도중 화면 상태가
  // 초기화되는 불안정한 실패가 생긴다.
  outputDir: resolve(REPO_ROOT, '.agent-runtime', 'calendar-e2e', 'test-results'),
  // 개발 서버는 경로마다 처음 들어갈 때 컴파일한다. 첫 요청이 10초 가까이 걸릴 수 있어
  // 경로를 미리 열어 두고(globalSetup), 단언 대기 시간도 그만큼 넉넉하게 잡는다.
  globalSetup: resolve(__dirname, 'global-setup.ts'),
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    // 공유 pnpm PATH에 기대지 않고 현재 Worktree의 next를 직접 실행한다.
    command: `node node_modules/next/dist/bin/next dev --port ${PORT} --hostname ${HOST}`,
    cwd: REPO_ROOT,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: buildWebServerEnv(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseKey,
      NEXT_PUBLIC_DEMO_MODE: 'false',
      NEXT_PUBLIC_SITE_URL: baseURL,
    }),
  },
});
