import { expect, test } from '@playwright/test';

import {
  assertRpcOk,
  callRpc,
  createDoneEvent,
  createDoneWish,
  dateRecordsPanel,
  gotoWishDetail,
  loadDateAccounts,
  login,
  memoryIdFromUrl,
  newRequestId,
  uniqueTitle,
  userClient,
} from './helpers';

/**
 * 완료한 원본 → 데이트 기록 작성 진입과 미리 채우기(DATE-001).
 *
 * 확인하려는 계약
 *   1. 해낸 위시·완료한 일정 상세에 기록 작성 입구가 있다.
 *   2. 입구 주소에는 **enum과 UUID만** 담는다(제목·날짜·장소를 URL에 싣지 않는다).
 *   3. 제목·날짜는 서버가 원본을 다시 읽어 채운다.
 *   4. 저장하면 원본 상세의 "데이트 기록" 칸에서 그 기록을 찾을 수 있다.
 *   5. 아직 완료하지 않은 원본에는 입구를 만들지 않는다.
 */

const accounts = loadDateAccounts();

test('해낸 위시에서 기록을 남기면 위시 상세에서 다시 찾을 수 있다', async ({ page }) => {
  const wishTitle = uniqueTitle('위시원본');
  const wishId = await createDoneWish(accounts.a, wishTitle);

  await login(page, accounts.a);
  await gotoWishDetail(page, wishId);

  const panel = dateRecordsPanel(page);
  await expect(panel).toContainText('아직 남긴 기록이 없어요');

  const entry = panel.getByRole('link', { name: /기록 남기기/ });
  await expect(entry).toBeVisible();
  await entry.click();

  // 주소에는 enum과 UUID만 있다. 제목은 URL에 실리지 않는다.
  await expect(page).toHaveURL(new RegExp(`/memories/new\\?source=wish&sourceId=${wishId}$`));
  expect(page.url()).not.toContain(encodeURIComponent(wishTitle.slice(0, 4)));

  // 제목은 서버가 원본에서 읽어 채운다.
  const titleField = page.getByLabel('제목');
  await expect(titleField).toHaveValue(wishTitle);

  await page.getByRole('button', { name: /저장/ }).first().click();
  // 저장 후에는 `?notice=saved-linked`(또는 정리 대기 변형)가 붙는다. 쿼리를 허용한다.
  await page.waitForURL(/\/memories\/[0-9a-f-]{36}(?:\?notice=[a-z-]+)?$/);
  const memoryId = memoryIdFromUrl(page);

  await gotoWishDetail(page, wishId);
  const saved = dateRecordsPanel(page);
  await expect(saved.getByRole('link', { name: new RegExp(wishTitle) })).toBeVisible();
  await expect(saved).toContainText('지울 수 없어요');
  expect(memoryId).toMatch(/^[0-9a-f-]{36}$/);
});

test('완료한 일정에도 같은 입구가 있다', async ({ page }) => {
  const eventTitle = uniqueTitle('일정원본');
  const eventId = await createDoneEvent(accounts.a, eventTitle);

  await login(page, accounts.a);
  await page.goto(`/calendar/${eventId}`);

  const panel = dateRecordsPanel(page);
  const entry = panel.getByRole('link', { name: /기록 남기기/ });
  await expect(entry).toBeVisible();
  await entry.click();

  await expect(page).toHaveURL(new RegExp(`/memories/new\\?source=event&sourceId=${eventId}$`));
  await expect(page.getByLabel('제목')).toHaveValue(eventTitle);
});

test('아직 완료하지 않은 위시에는 작성 입구가 없다', async ({ page }) => {
  const client = await userClient(accounts.a);
  const title = uniqueTitle('미완료위시');
  const created = await callRpc(client, 'save_wish', {
    p_wish_id: null,
    p_title: title,
    p_category: 'activity',
    p_memo: '',
    p_link_url: null,
    p_expected_version: 0,
    p_request_id: newRequestId(),
  });
  const wishId = (assertRpcOk(created, '미완료 위시 생성') as unknown as { wishId: string }).wishId;

  await login(page, accounts.a);
  await gotoWishDetail(page, wishId);

  const panel = dateRecordsPanel(page);
  await expect(panel).toContainText('완료로 표시한 뒤에');
  await expect(panel.getByRole('link', { name: /기록 남기기/ })).toHaveCount(0);
});
