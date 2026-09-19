import { expect, test } from '@playwright/test';

import {
  ensureSpace,
  forceStoredSessionExpiry,
  loadAccounts,
  login,
  readLocalAuthConfig,
  readSessionCookies,
  revokeAllSessions,
  waitForScreen,
} from './helpers';

/**
 * 세션 갱신(refresh token) 흐름.
 *
 * ## 무엇을 모의하고 무엇이 진짜인가
 *
 * - **모의**: 브라우저 쿠키에 저장된 세션의 `expires_at`만 과거로 바꾼다.
 *   즉 "클라이언트가 가진 만료 정보"를 만료 상태로 만든 것이다.
 *   Auth 서버의 벽시계 기준 만료(JWT_EXP=3600)를 앞당기지 않았고, 컨테이너 설정도 바꾸지 않았다.
 * - **진짜**: refresh token은 로컬 Auth 서버가 발급한 **유효한 값 그대로**다.
 *   따라서 앱 서버는 실제로 `/auth/v1/token?grant_type=refresh_token`을 호출해
 *   새 세션을 받아야 하고, 그 결과가 응답 쿠키로 다시 내려와야 한다.
 *
 * 즉 "만료를 감지하고 → 실제로 갱신하고 → 갱신된 쿠키를 응답에 싣는" 경로는 실제로 실행된다.
 * 서버 벽시계가 지난 뒤의 만료는 이 테스트로 증명되지 않는다(위 구분을 그대로 보고한다).
 *
 * ## 갱신을 어떻게 확인하는가
 *
 * 갱신 호출(`/auth/v1/token?grant_type=refresh_token`)은 **앱 서버가 Auth 서버로** 보내므로
 * 브라우저 네트워크에서는 보이지 않는다. 그래서 브라우저에서 관찰할 수 있는 결과로 확인한다.
 *   1. 그 응답에 갱신된 세션 쿠키가 실렸는가(`Set-Cookie`),
 *   2. 저장된 access token이 실제로 **다른 값**으로 바뀌었는가(갱신 없이는 바뀔 수 없다),
 *   3. 만료 시각이 미래로 갱신됐는가, 그리고 보호된 화면이 계속 열리는가.
 * 폐기 시나리오는 같은 조작에서 갱신이 **실패**하는 것으로 대조군이 된다.
 *
 * 토큰 값은 어떤 단언·로그에도 넣지 않는다. 비교는 boolean으로만 한다.
 */

const accounts = loadAccounts();

test.describe.configure({ mode: 'serial' });

const AUTH_COOKIE_PATTERN = /^sb-.*-auth-token(\.\d+)?$/;

test('저장된 세션이 만료로 표시되면 서버가 갱신하고 새 쿠키를 응답에 싣는다', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await login(page, accounts.a);
  await ensureSpace(page);

  const before = await readSessionCookies(context);
  expect(before, '로그인 후 세션 쿠키가 있어야 한다').not.toBeNull();
  if (!before) return;

  // 값 자체가 아니라 존재 여부만 확인한다.
  expect(before.session.refresh_token.length > 0).toBe(true);
  expect(typeof before.session.expires_at === 'number').toBe(true);

  // 브라우저 클라이언트가 먼저 갱신해 버리면 "서버가 갱신했다"를 확인할 수 없다.
  // 앱 화면을 모두 닫아 브라우저 클라이언트를 없앤 뒤 쿠키를 고치고 새 탭으로 들어간다.
  await page.close();
  await forceStoredSessionExpiry(context, before);

  const afterForced = await readSessionCookies(context);
  expect(afterForced?.session.expires_at).toBeLessThan(Math.floor(Date.now() / 1000));
  // refresh token은 그대로 유효한 값을 유지한다.
  expect(afterForced?.session.refresh_token === before.session.refresh_token).toBe(true);

  const fresh = await context.newPage();
  const response = await fresh.goto('/settings');
  await waitForScreen(fresh, ['settings']);

  // 1) 갱신된 세션이 응답 쿠키로 다시 내려온다.
  const headers = response ? await response.headersArray() : [];
  const setCookieNames = headers
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value.split('=')[0] ?? '');
  expect(
    setCookieNames.some((name) => AUTH_COOKIE_PATTERN.test(name)),
    '갱신된 세션 쿠키가 응답에 실려야 한다',
  ).toBe(true);

  // 2) 갱신 응답도 공유 캐시에 저장되지 않는다.
  expect(response?.headers()['cache-control']).toContain('no-store');

  // 3) 저장된 세션이 실제로 새 값으로 바뀐다(값은 출력하지 않는다).
  const after = await readSessionCookies(context);
  expect(after, '갱신 후에도 세션 쿠키가 있어야 한다').not.toBeNull();
  if (!after) return;

  expect(after.session.expires_at ?? 0).toBeGreaterThan(Math.floor(Date.now() / 1000));
  expect(
    after.session.access_token !== before.session.access_token,
    '새 access token으로 바뀌어야 한다',
  ).toBe(true);
  expect(after.session.refresh_token.length > 0).toBe(true);

  // 4) 갱신 뒤에도 보호된 화면이 정상 동작한다.
  await fresh.goto('/');
  await waitForScreen(fresh, ['home']);

  await context.close();
});

test('폐기된 refresh token으로는 갱신하지 못하고 로그인 화면으로 보낸다', async ({ browser }) => {
  const config = readLocalAuthConfig();
  test.skip(
    config === null,
    '로컬 Auth 주소·공개 키가 없어 폐기 시나리오를 실행할 수 없습니다.',
  );
  if (!config) return;

  const context = await browser.newContext();
  const page = await context.newPage();

  // 공간이 없는 외부 계정으로 확인한다. 다른 시나리오의 상태를 건드리지 않는다.
  await login(page, accounts.c);
  await waitForScreen(page, ['onboarding']);

  const session = await readSessionCookies(context);
  expect(session).not.toBeNull();
  if (!session) return;

  // 이 사용자의 refresh token을 서버에서 모두 폐기한다(로컬 Auth 서버, 합성 계정).
  const revoked = await revokeAllSessions(config, session.session.access_token);
  expect(revoked, 'Auth 서버가 세션 폐기를 받아들여야 한다').toBe(true);

  // 클라이언트가 만료로 판단하도록 만들면 갱신을 시도하고, 폐기됐으므로 실패해야 한다.
  await page.close();
  await forceStoredSessionExpiry(context, session);

  const fresh = await context.newPage();
  await fresh.goto('/settings');
  await waitForScreen(fresh, ['login']);
  await expect(fresh).toHaveURL(/\/login\?next=%2Fsettings$/);

  await context.close();
});
