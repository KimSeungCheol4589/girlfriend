import { expect, test } from '@playwright/test';

import {
  SAVE_BUTTON,
  openCustomize,
  openSession,
  readSettings,
  requireEnv,
  resetSettings,
  themeButton,
  tokenFor,
  type Session,
} from './helpers';

/**
 * 서버에 사진 확정 키가 없을 때(THEME_TEST_PHOTOS=off).
 *
 *   THEME_TEST_PHOTOS=off pnpm exec playwright test --config playwright.customize.config.ts \
 *     tests/customize/e2e/photos-disabled.spec.ts
 *
 * 규칙: **새 커버 업로드만** 막고, 나머지 저장과 이미 저장된 커버 조회는 그대로 동작해야 한다.
 * 키가 없는데도 올릴 수 있는 것처럼 보이면 확정할 수 없는 파일만 쌓인다.
 */

const { env, accounts } = requireEnv();
const photosDisabled = (process.env.THEME_TEST_PHOTOS ?? 'on') === 'off';

test.describe.configure({ mode: 'serial' });

test.describe('사진 기능이 꺼진 서버', () => {
  test.skip(!photosDisabled, 'THEME_TEST_PHOTOS=off로 실행할 때만 검증한다.');

  let a: Session;
  let tokenA = '';

  test.beforeAll(async ({ browser }) => {
    tokenA = await tokenFor(env, accounts.a);
    await resetSettings(env, tokenA);
    a = await openSession(browser, accounts.a);
  });

  test.afterAll(async () => {
    await a?.context.close();
    await resetSettings(env, tokenA);
  });

  test('커버 업로드는 이유와 함께 막히고 다른 저장은 계속 된다', async () => {
    await openCustomize(a.page);

    await expect(a.page.getByLabel('사진 고르기')).toBeDisabled();
    await expect(a.page.getByText('서버에 사진 확인 설정이 없어')).toBeVisible();

    const before = await readSettings(env, tokenA);
    await themeButton(a.page, '로즈').click();
    await a.page.getByRole('button', { name: SAVE_BUTTON }).click();
    await expect(a.page.getByText('꾸미기 설정을 저장했어요')).toBeVisible();

    const after = await readSettings(env, tokenA);
    expect(after.theme_key).toBe('rose');
    expect(after.version).toBe(before.version + 1);
  });

  test('홈 화면도 평소처럼 열린다', async () => {
    await a.page.goto('/');
    await expect(a.page.getByRole('heading', { name: '우리 공간 구성원' })).toBeVisible();
  });
});
