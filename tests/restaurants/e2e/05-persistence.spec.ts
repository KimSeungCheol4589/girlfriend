import { expect, test } from '@playwright/test';

import { createRestaurantViaUi, gotoDetail, gotoRestaurants, loadFoodAccounts, login, uniqueName } from './helpers';

import { logout } from '../../auth/e2e/helpers';

/**
 * 새로 로그인해도 맛집·방문·후기가 유지되고, 상대방 계정에서도 같은 내용이 보인다(PROJECT_PLAN 3·8).
 * 브라우저 상태가 아니라 서버 저장을 확인하기 위해 로그아웃 뒤 **새 브라우저 컨텍스트**로 다시 들어간다.
 */

const accounts = loadFoodAccounts();

test('로그아웃 후 다시 로그인해도 저장한 맛집·방문일·후기가 남아 있고 B에게도 보인다', async ({ browser }) => {
  const name = uniqueName('지속');

  const first = await browser.newContext();
  const page = await first.newPage();
  let id = '';
  try {
    await login(page, accounts.a);
    id = await createRestaurantViaUi(page, { name, area: '망원', category: '카페', memo: '다시 와도 남아 있어야 함' });
    await page.getByRole('button', { name: '다녀왔어요' }).click();
    await expect(page.getByText(/다녀온 곳으로 저장했어요/)).toBeVisible();
    await page.getByRole('radio', { name: /5점/ }).check({ force: true });
    await page.getByLabel('한 줄 후기').fill('지속성 확인 후기');
    await page.getByRole('button', { name: '내 후기 저장' }).click();
    await expect(page.getByText('내 후기를 저장했어요.')).toBeVisible();
    await logout(page);

    // 로그아웃한 컨텍스트에서는 보호된 주소가 열리지 않는다
    await page.goto(`/restaurants/${id}`);
    await expect(page.getByRole('heading', { name: '로그인', exact: true })).toBeVisible();
  } finally {
    await first.close();
  }

  const second = await browser.newContext();
  const again = await second.newPage();
  try {
    await login(again, accounts.a);
    await gotoRestaurants(again, `?q=${encodeURIComponent(name)}&status=visited`);
    await expect(again.getByTestId('restaurant-list').getByRole('link')).toHaveCount(1);
    await gotoDetail(again, id);
    await expect(again.getByRole('heading', { name })).toBeVisible();
    await expect(again.getByText('다시 와도 남아 있어야 함')).toBeVisible();
    await expect(again.getByLabel('한 줄 후기')).toHaveValue('지속성 확인 후기');
    await expect(again.getByRole('radio', { name: /5점/ })).toBeChecked();
  } finally {
    await second.close();
  }

  const partner = await browser.newContext();
  const pageB = await partner.newPage();
  try {
    await login(pageB, accounts.b);
    await gotoDetail(pageB, id);
    await expect(pageB.getByTestId('partner-review')).toContainText('지속성 확인 후기');
  } finally {
    await partner.close();
  }
});
