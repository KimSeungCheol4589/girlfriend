import { defineConfig, devices } from '@playwright/test';

import { buildWebServerEnv } from './tests/auth/web-server-env';

/**
 * MEM-001 실제 추억 E2E 전용 설정(로컬 Supabase + 합성 계정).
 *
 *   node tests/memories/fixtures/cli.mjs setup
 *   pnpm exec playwright test --config playwright.memories.config.ts
 *   node tests/memories/fixtures/cli.mjs teardown
 *
 * - 앱은 127.0.0.1:3003에만 바인딩한다(데모 3001, 인증 3002와 분리).
 * - 데모 모드를 끄고 실제 Supabase 설정으로 띄운다. 설정이 없으면 여기서 멈춘다.
 * - 앱 서버에는 `MEM_SUPABASE_SERVICE_ROLE_KEY` **하나만** 사진 확정·정리용으로 넘긴다
 *   (MEM_TEST_PHOTOS=off면 넘기지 않아 "사진 기능 꺼짐" 동작을 볼 수 있다).
 *   테스트 러너 전용 키 이름(`*_TEST_SERVICE_ROLE_KEY`)은 빈 값으로 덮어써 상속을 막는다.
 * - trace·video·screenshot을 끄고, 실패 문맥 파일의 페이지 스냅샷은 인증 리포터로 지운다.
 */
const PORT = Number(process.env.MEM_E2E_PORT ?? 3003);
const HOST = '127.0.0.1';
const baseURL = `http://${HOST}:${PORT}`;

const supabaseUrl = (process.env.MEM_TEST_SUPABASE_URL ?? process.env.AUTH_TEST_SUPABASE_URL ?? '').trim();
const supabaseKey = (process.env.MEM_TEST_ANON_KEY ?? process.env.AUTH_TEST_ANON_KEY ?? '').trim();
const serviceKey = (process.env.MEM_TEST_SERVICE_ROLE_KEY ?? process.env.AUTH_TEST_SERVICE_ROLE_KEY ?? '').trim();
const photosOn = (process.env.MEM_TEST_PHOTOS ?? 'on') !== 'off';

if (supabaseUrl === '' || supabaseKey === '') {
  throw new Error(
    '추억 E2E에는 로컬 Supabase 주소와 공개 키가 필요합니다. MEM_TEST_SUPABASE_URL / MEM_TEST_ANON_KEY를 설정하세요(값은 출력하지 않습니다).',
  );
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(supabaseUrl).hostname)) {
  throw new Error('추억 E2E는 로컬(loopback) Supabase에서만 실행합니다.');
}

const serverEnv = buildWebServerEnv(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseKey,
  NEXT_PUBLIC_DEMO_MODE: 'false',
  NEXT_PUBLIC_SITE_URL: baseURL,
});
// buildWebServerEnv가 모든 *SERVICE_ROLE* 키(AUTH_TEST_/MEM_TEST_/SUPABASE_ 포함)를 비운 뒤,
// 앱이 읽는 MEM 전용 서버 키 하나만 다시 넣는다.
serverEnv.MEM_SUPABASE_SERVICE_ROLE_KEY = photosOn ? serviceKey : '';

export default defineConfig({
  testDir: './tests/memories/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], ['./tests/auth/reporters/redact-error-context.ts']],
  timeout: 120_000,
  // 전체 실행 상한. 멈춘 실행이 다른 작업을 막지 않게 한다.
  globalTimeout: 30 * 60_000,
  expect: { timeout: 20_000 },
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
    command: `pnpm exec next dev --port ${PORT} --hostname ${HOST}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: serverEnv,
  },
});
