import { expect, test } from '@playwright/test';

import { ensureSpace, loadAccounts, login, logout, pathnameOf, waitForScreen } from './helpers';

/**
 * 로그인·세션·공간 생성 기본 흐름.
 *
 * 전제: `node tests/auth/fixtures/cli.mjs setup`으로 합성 계정 A~D를 만들고
 * A만 최초 공간 생성 허용 목록에 넣는다.
 *
 * 화면 판정은 렌더된 내용으로 한다. 서버 컴포넌트의 `redirect()`가 스트리밍으로 전달되면
 * `goto()` 직후의 주소는 아직 중간 상태다(1차 실행에서 이 가정 때문에 실패했다).
 */

const accounts = loadAccounts();

test.describe.configure({ mode: 'serial' });

test('비로그인 상태로 보호된 주소에 직접 들어가면 로그인 화면으로 보낸다', async ({ page }) => {
  await page.goto('/');
  await waitForScreen(page, ['login']);
  expect(pathnameOf(page)).toBe('/login');

  await page.goto('/settings');
  await waitForScreen(page, ['login']);
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);

  await page.goto('/memories');
  await waitForScreen(page, ['login']);
  await expect(page).toHaveURL(/\/login\?next=%2Fmemories$/);
});

test('개인 화면 응답은 공유 캐시에 저장하지 않는다', async ({ page }) => {
  const response = await page.goto('/login');
  expect(response?.headers()['cache-control']).toContain('no-store');
});

test('A는 로그인 후 공간이 없으면 만들고 홈을 본다', async ({ page }) => {
  await login(page, accounts.a);

  // 픽스처를 새로 만든 직후에는 공간이 없어 온보딩이 뜬다. 이미 있으면 그대로 홈이다.
  await ensureSpace(page);

  expect(pathnameOf(page)).toBe('/');
  await expect(page.getByRole('heading', { name: '둘이 쌓는 공간' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '우리 공간 구성원' })).toBeVisible();
});

test('실제 모드의 추억 화면은 데모가 아니라 실제 추억 목록을 보여 준다', async ({ page }) => {
  await login(page, accounts.a);
  await ensureSpace(page);

  await page.goto('/memories');
  await waitForScreen(page, ['pending']);

  // MEM-001 이후 실제 목록 화면(필터·새 기록 진입)이다. 준비 중 안내가 아니다.
  await expect(page.getByRole('heading', { name: '월·태그로 추리기' })).toBeVisible();
  await expect(page.getByRole('link', { name: '새 추억 쓰기' }).first()).toBeVisible();
  await expect(page.getByText('준비 중')).toHaveCount(0);
  // 데모 예시 데이터·데모 고지가 실제 화면에 섞이면 안 된다.
  await expect(page.getByText('데모 모드')).toHaveCount(0);
  await expect(page.getByText('브라우저 메모리에만')).toHaveCount(0);
});

test('로그인 화면의 next 값으로 외부 주소로 보낼 수 없다', async ({ page, baseURL }) => {
  await login(page, accounts.a, 'https://evil.example/steal');
  await ensureSpace(page);

  // 앱 출처를 벗어나지 않고 기본 화면으로 보낸다.
  expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? '').origin);
  expect(pathnameOf(page)).toBe('/');
  await expect(page.getByRole('heading', { name: '우리 공간 구성원' })).toBeVisible();
});

test('세션은 새로 고침과 새 탭에서도 유지되고, 로그아웃하면 사라진다', async ({ page, context }) => {
  await login(page, accounts.a);
  await ensureSpace(page);

  await page.reload();
  await waitForScreen(page, ['home']);

  const second = await context.newPage();
  await second.goto('/settings');
  await waitForScreen(second, ['settings']);
  await second.close();

  await logout(page);
  expect(pathnameOf(page)).toBe('/login');

  // 로그아웃 뒤에는 세션 쿠키가 남지 않는다.
  const remaining = (await context.cookies()).filter((cookie) =>
    /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name),
  );
  expect(remaining.map((cookie) => cookie.name)).toEqual([]);

  // 직접 주소로 들어가도 열리지 않는다.
  await page.goto('/settings');
  await waitForScreen(page, ['login']);
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
});

test('한 탭에서 로그아웃하면 다른 탭도 로그인 화면으로 바뀌고 보관한 초대 토큰이 사라진다', async ({
  context,
}) => {
  const first = await context.newPage();
  await login(first, accounts.a);
  await ensureSpace(first);

  // 두 번째 탭에서 개인 화면을 열어 둔다.
  const second = await context.newPage();
  await second.goto('/settings');
  await waitForScreen(second, ['settings']);

  // 이 탭에 초대 토큰이 보관된 상황을 만든다(형식만 맞춘 가짜 값).
  await second.evaluate(() => {
    window.sessionStorage.setItem(
      'gf.invite.token',
      JSON.stringify({ token: 'e'.repeat(43), storedAt: Date.now() }),
    );
  });

  await logout(first);

  // 다른 탭은 알림을 받아 서버 렌더를 다시 받고, 세션이 없으므로 로그인 화면으로 간다.
  await waitForScreen(second, ['login']);

  const hasStoredToken = await second.evaluate(
    () => window.sessionStorage.getItem('gf.invite.token') !== null,
  );
  expect(hasStoredToken, '다른 탭의 보관 토큰도 지워져야 한다').toBe(false);

  await second.close();
  await first.close();
});

test('허용 목록에 없는 계정은 공간을 만들 수 없다', async ({ page }) => {
  await login(page, accounts.c);
  await waitForScreen(page, ['onboarding']);

  await page.getByLabel('공간 이름').fill('외부 계정 공간');
  await page.getByRole('button', { name: '공간 만들기' }).click();

  await expect(page.getByText(/만들 권한이 없습니다/)).toBeVisible();
  expect(pathnameOf(page)).toBe('/onboarding');
});

test('잘못된 비밀번호는 계정 존재 여부를 알려 주지 않는다', async ({ page }) => {
  await page.goto('/login');
  await waitForScreen(page, ['login']);

  await page.getByLabel('이메일').fill(accounts.a.email);
  // 실제 비밀번호를 쓰지 않는다. 값은 화면·로그에 남지 않는 고정 오답이다.
  await page.getByLabel('비밀번호').fill('wrong-password-for-e2e');
  await page.getByRole('button', { name: '로그인' }).click();

  await expect(page.getByText('이메일 또는 비밀번호가 올바르지 않습니다.')).toBeVisible();
  expect(pathnameOf(page)).toBe('/login');
});
