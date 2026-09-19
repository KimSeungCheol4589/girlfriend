import { expect, test } from '@playwright/test';

import {
  generateRecoveryTokenHash,
  loadAccounts,
  logout,
  pathnameOf,
  readLocalAuthConfig,
  temporaryPassword,
  waitForScreen,
} from './helpers';

/**
 * 인증 콜백과 비밀번호 재설정.
 *
 * ## 검증 범위와 한계 (중요)
 *
 * - 확인 링크는 로컬 Auth 관리 API(`/admin/generate_link`)로 만든 **token_hash**를 쓰고,
 *   앱의 `/auth/confirm` 경로로 직접 연다. 실제 **메일 발송·수신 경로는 검증하지 않는다.**
 * - 현재 로컬 Auth는 `SITE_URL=http://127.0.0.1:3000`,
 *   `URI_ALLOW_LIST=https://127.0.0.1:3000`이고 앱은 3002에서 돈다.
 *   따라서 **메일에 담기는 링크가 3002로 돌아오는지는 검증되지 않았다.**
 *   이 테스트는 "token_hash를 받은 앱 경로가 올바르게 동작하는지"만 확인한다.
 *   컨테이너·Auth 설정은 바꾸지 않았다.
 * - 계정 D만 사용한다. 이 스펙은 D의 비밀번호를 실행 중에 바꾸므로 다른 시나리오에 영향이 없다.
 *   (다시 실행할 때는 픽스처 teardown → setup으로 알려진 상태에서 시작한다.)
 *
 * 토큰·비밀번호는 단언 값·로그에 넣지 않는다. 주소 단언도 경로만 쓴다.
 */

const accounts = loadAccounts();

test.describe.configure({ mode: 'serial' });

test('재설정 메일 요청은 계정 존재 여부를 알려 주지 않는다', async ({ page }) => {
  await page.goto('/reset-password');
  await waitForScreen(page, ['resetRequest']);

  await page.getByLabel('이메일').fill(`unknown-${Date.now()}@test.invalid`);
  await page.getByRole('button', { name: '재설정 메일 보내기' }).click();

  await expect(page.getByText(/등록된 계정이라면 메일이 도착합니다/)).toBeVisible();
});

test('관리자가 만든 token_hash로 새 비밀번호를 정하고 그 비밀번호로 로그인한다', async ({
  page,
  baseURL,
}) => {
  const appOrigin = new URL(baseURL ?? '').origin;
  const config = readLocalAuthConfig();
  test.skip(config === null, '로컬 Auth 설정이 없어 실행할 수 없습니다.');
  if (!config) return;

  const tokenHash = await generateRecoveryTokenHash(config, accounts.d.email);
  test.skip(
    tokenHash === null,
    'AUTH_TEST_SERVICE_ROLE_KEY가 없어 복구 링크를 만들 수 없습니다.',
  );
  if (!tokenHash) return;

  // 토큰은 주소에만 실리고 단언 값으로 쓰지 않는다.
  await page.goto(
    `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery&next=%2Freset-password`,
  );
  await waitForScreen(page, ['newPassword']);
  expect(pathnameOf(page)).toBe('/reset-password');
  // 콜백이 다른 host로 보내면 방금 심은 세션 쿠키가 전달되지 않는다(실제로 겪은 결함).
  expect(new URL(page.url()).origin).toBe(appOrigin);

  const nextPassword = temporaryPassword();
  await page.getByLabel('새 비밀번호', { exact: true }).fill(nextPassword);
  await page.getByLabel('새 비밀번호 확인').fill(nextPassword);
  await page.getByRole('button', { name: '새 비밀번호 저장' }).click();

  // D는 공간이 없으므로 저장 후 온보딩으로 간다.
  await waitForScreen(page, ['home', 'onboarding']);

  await logout(page);

  // 새 비밀번호로 실제 로그인이 된다.
  await page.getByLabel('이메일').fill(accounts.d.email);
  await page.getByLabel('비밀번호').fill(nextPassword);
  await page.getByRole('button', { name: '로그인' }).click();
  await waitForScreen(page, ['onboarding', 'home']);

  await logout(page);

  // 같은 token_hash를 다시 쓰면 거부된다.
  await page.goto(
    `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery&next=%2Freset-password`,
  );
  await waitForScreen(page, ['resetRequest']);
  expect(pathnameOf(page)).toBe('/reset-password');
  await expect(page.getByText('링크를 사용할 수 없어요')).toBeVisible();
});

test('잘못된 확인 링크는 안내와 함께 거부한다', async ({ page }) => {
  // 형식이 맞지 않는 token_hash
  await page.goto('/auth/confirm?token_hash=not-a-real-token&type=recovery');
  await waitForScreen(page, ['resetRequest']);
  expect(pathnameOf(page)).toBe('/reset-password');
  await expect(page.getByText('링크를 사용할 수 없어요')).toBeVisible();

  // 허용하지 않는 type
  await page.goto('/auth/confirm?token_hash=not-a-real-token&type=not-a-type');
  await waitForScreen(page, ['login']);
  expect(pathnameOf(page)).toBe('/login');
  await expect(page.getByText('인증 링크를 사용할 수 없어요')).toBeVisible();

  // token_hash 없음: 재설정 링크였으므로 재설정 화면에서 안내한다.
  await page.goto('/auth/confirm?type=recovery');
  await waitForScreen(page, ['resetRequest']);
  expect(pathnameOf(page)).toBe('/reset-password');
  await expect(page.getByText('링크를 사용할 수 없어요')).toBeVisible();

  // 종류를 알 수 없는 링크는 로그인 화면에서 안내한다.
  await page.goto('/auth/confirm');
  await waitForScreen(page, ['login']);
  expect(pathnameOf(page)).toBe('/login');
});

test('PKCE 콜백 실패와 공급자 오류도 내부 화면으로만 보낸다', async ({ page }) => {
  await page.goto('/auth/callback?code=not-a-real-code');
  await waitForScreen(page, ['login']);
  expect(pathnameOf(page)).toBe('/login');
  await expect(page.getByText('인증 링크를 사용할 수 없어요')).toBeVisible();

  await page.goto('/auth/callback?error=access_denied&error_description=denied');
  await waitForScreen(page, ['login']);
  expect(pathnameOf(page)).toBe('/login');

  await page.goto('/auth/callback');
  await waitForScreen(page, ['login']);
  expect(pathnameOf(page)).toBe('/login');
});

test('콜백의 next 값으로 외부 주소로 나갈 수 없다', async ({ page, baseURL }) => {
  const appOrigin = new URL(baseURL ?? '').origin;

  await page.goto('/auth/callback?code=not-a-real-code&next=https%3A%2F%2Fevil.example%2Fsteal');
  await waitForScreen(page, ['login']);
  expect(new URL(page.url()).origin).toBe(appOrigin);
  expect(pathnameOf(page)).toBe('/login');

  await page.goto(
    '/auth/confirm?token_hash=not-a-real-token&type=recovery&next=https%3A%2F%2Fevil.example',
  );
  await waitForScreen(page, ['resetRequest']);
  expect(new URL(page.url()).origin).toBe(appOrigin);
  expect(pathnameOf(page)).toBe('/reset-password');
});
