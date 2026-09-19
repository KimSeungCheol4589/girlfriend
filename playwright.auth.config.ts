import { defineConfig, devices } from '@playwright/test';

/**
 * 실패 산출물의 페이지 스냅샷 처리 — 설치된 1.63.0에서 **직접 실험해 확인한 사실**:
 *
 *   - `trace`·`video`·`screenshot`을 모두 꺼도 실패하면 `error-context.md`가 만들어지고,
 *     그 안의 aria 스냅샷에는 **입력 필드 값이 그대로** 들어간다(`type="password"` 포함).
 *   - `PLAYWRIGHT_NO_COPY_PROMPT=1`은 **효과가 없었다.** 설정 파일에서 켜도, 러너 프로세스
 *     환경으로 넘겨도 스냅샷이 그대로 남았다(1차 판단이 틀렸다).
 *
 * 그래서 공개 리포터 API로 파일이 만들어진 뒤 스냅샷 블록만 덜어 낸다.
 * 오류 메시지·호출 로그·테스트 소스는 그대로 남아 진단에 쓸 수 있다.
 * (검증 절차는 docs/handoffs/AUTH-001.md에 적어 두었다.)
 */

/**
 * 인증 E2E 전용 설정.
 *
 * - 데모 E2E(`playwright.config.ts`, 포트 3001)와 포트·testDir·서버 환경을 분리한다.
 * - 포트 3002에 **loopback으로만** 바인딩한다.
 * - 데모 모드를 명시적으로 끄고 실제 Supabase 설정으로 서버를 띄운다.
 *   설정이 없으면 앱이 "설정 필요"를 그리므로 테스트가 실패한다(조용히 통과하지 않는다).
 *
 * 준비: `node tests/auth/fixtures/cli.mjs setup` (합성 계정 생성, 로컬 전용)
 */
const PORT = Number(process.env.AUTH_E2E_PORT ?? 3002);
const HOST = '127.0.0.1';
const baseURL = process.env.AUTH_E2E_BASE_URL ?? `http://${HOST}:${PORT}`;

/** 현재 프로세스 환경을 그대로 물려주되 아래에서 인증 관련 값만 덮어쓴다. */
const inheritedEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);

const supabaseUrl =
  process.env.AUTH_TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseKey =
  process.env.AUTH_TEST_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';

// 설정이 없으면 앱이 "설정 필요" 화면을 그려 모든 단언이 헷갈리게 실패한다. 먼저 멈춘다.
if (supabaseUrl.trim() === '' || supabaseKey.trim() === '') {
  throw new Error(
    '인증 E2E에는 로컬 Supabase 주소와 공개 키가 필요합니다. ' +
      'AUTH_TEST_SUPABASE_URL / AUTH_TEST_ANON_KEY를 설정하세요(값은 출력하지 않습니다).',
  );
}

export default defineConfig({
  testDir: './tests/auth/e2e',
  // 같은 계정·공간 상태를 공유하므로 순서대로 실행한다.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], ['./tests/auth/reporters/redact-error-context.ts']],
  // 개발 서버는 경로마다 처음 들어갈 때 컴파일한다. 첫 방문이 느려 기본 30초로는 부족하다.
  // (1차 실행에서 첫 테스트가 컴파일을 기다리다 타임아웃했다.)
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    // 추적 파일에 세션 쿠키가 담기므로 남기지 않는다.
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
    // 다른 환경 변수로 떠 있는 서버를 재사용하면 검증 의미가 사라진다.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...inheritedEnv,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseKey,
      NEXT_PUBLIC_DEMO_MODE: 'false',
      NEXT_PUBLIC_SITE_URL: baseURL,
    },
  },
});
