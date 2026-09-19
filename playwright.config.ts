import { defineConfig, devices } from '@playwright/test';

/**
 * UI 검증용 포트는 3001이다(총괄 통합 앱은 3000).
 * 브라우저 바이너리는 저장소에 포함하지 않는다. 최초 1회 `pnpm exec playwright install`이 필요하다.
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3001);
// next dev가 기본으로 localhost에 바인딩하므로 같은 호스트명을 쓴다(교차 출처 경고 방지).
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
