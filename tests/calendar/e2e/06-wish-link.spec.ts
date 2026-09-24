import { expect, test } from '@playwright/test';

import {
  apiCreateEvent,
  apiCreateWish,
  apiDeleteWish,
  apiEvent,
  apiWishExists,
  callRpc,
  createEventViaUi,
  eventArgs,
  gotoDetail,
  loadCalendarAccounts,
  login,
  newRequestId,
  stableMonthDay,
  uniqueTitle,
  userClient,
} from './helpers';

/**
 * 위시 연결과 **위시 삭제 의미**(CAL-001에서 확정).
 *
 *   - 같은 공간의 위시만 연결한다. 다른 공간·없는 위시는 존재 여부를 알리지 않고 NOT_FOUND다.
 *   - 연결된 일정이 있는 위시는 **지워지지 않고 CONFLICT로 거부된다.** 자동 연쇄 삭제도,
 *     자동 연결 해제도 하지 않는다(사용자가 모르는 사이에 계획이 사라지지 않게).
 *   - 그 거부가 `UNKNOWN`/무한 재시도로 보이지 않고 원인을 알려 주는지 확인한다.
 *   - 일정을 지우거나 연결을 해제하면 위시를 지울 수 있다.
 *
 * 위시 화면 자체는 이 작업에서 수정하지 않았다. 여기서는 위시 **RPC 계약**만 확인한다.
 */

const accounts = loadCalendarAccounts();

test.describe.configure({ mode: 'serial' });

const DAY = stableMonthDay(25);

test('같은 공간의 위시를 일정에 연결하고 상세에서 위시로 이동할 수 있다', async ({ page }) => {
  const api = await userClient(accounts.a);
  const wishTitle = uniqueTitle('벚꽃 보기');
  const wishId = await apiCreateWish(api, wishTitle);

  await login(page, accounts.a);
  const eventTitle = uniqueTitle('벚꽃 데이트');
  const eventId = await createEventViaUi(page, {
    title: eventTitle,
    kind: 'date',
    startDate: DAY,
    startTime: '13:00',
    wishTitle,
  });

  expect((await apiEvent(api, eventId))?.wish_item_id).toBe(wishId);

  const link = page.getByTestId('event-linked-wish').getByRole('link', { name: wishTitle });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', `/wishes/${wishId}`);
});

test('상대(B)도 연결된 위시를 볼 수 있다', async ({ page }) => {
  const apiA = await userClient(accounts.a);
  const wishTitle = uniqueTitle('상대 확인용 위시');
  const wishId = await apiCreateWish(apiA, wishTitle);
  const eventId = await apiCreateEvent(apiA, {
    title: uniqueTitle('상대 확인용 일정'),
    startDate: DAY,
    startTime: '14:00',
    wishItemId: wishId,
  });

  await login(page, accounts.b);
  await gotoDetail(page, eventId);
  await expect(page.getByTestId('event-linked-wish')).toContainText(wishTitle);
});

test('다른 공간·없는 위시는 연결할 수 없다(존재 여부를 알리지 않는다)', async () => {
  const apiA = await userClient(accounts.a);
  const apiC = await userClient(accounts.c);

  // C의 공간에 있는 위시 ID로 연결을 시도한다.
  const foreignWishId = await apiCreateWish(apiC, uniqueTitle('외부 공간 위시'));

  const result = await callRpc(apiA, 'save_calendar_event', {
    ...eventArgs({
      title: uniqueTitle('외부 위시 연결'),
      startDate: DAY,
      startTime: '15:00',
      wishItemId: foreignWishId,
    }),
    p_request_id: newRequestId(),
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe('GF404');

  const missing = await callRpc(apiA, 'save_calendar_event', {
    ...eventArgs({
      title: uniqueTitle('없는 위시 연결'),
      startDate: DAY,
      startTime: '15:30',
      wishItemId: '00000000-0000-4000-8000-000000000000',
    }),
    p_request_id: newRequestId(),
  });
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.code).toBe('GF404');
});

test('연결된 일정이 있는 위시는 삭제가 CONFLICT로 거부되고 위시가 남는다', async () => {
  const api = await userClient(accounts.a);
  const wishId = await apiCreateWish(api, uniqueTitle('삭제 거부 위시'));
  await apiCreateEvent(api, {
    title: uniqueTitle('연결된 일정'),
    startDate: DAY,
    startTime: '16:00',
    wishItemId: wishId,
  });

  const result = await apiDeleteWish(api, wishId, 1);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe('GF409');
    // 앱이 원인을 알 수 있도록 필드 힌트를 준다(UNKNOWN으로 떨어지지 않는다).
    expect(result.details).toContain('has_calendar_events');
  }
  expect(await apiWishExists(api, wishId)).toBe(true);
});

test('상대(B)가 지우려 해도 같은 이유로 거부된다', async () => {
  const apiA = await userClient(accounts.a);
  const apiB = await userClient(accounts.b);
  const wishId = await apiCreateWish(apiA, uniqueTitle('B 삭제 시도 위시'));
  await apiCreateEvent(apiA, {
    title: uniqueTitle('B 삭제 시도 일정'),
    startDate: DAY,
    startTime: '17:00',
    wishItemId: wishId,
  });

  const result = await apiDeleteWish(apiB, wishId, 1);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe('GF409');
    expect(result.details).toContain('has_calendar_events');
  }
  expect(await apiWishExists(apiA, wishId)).toBe(true);
});

test('일정에서 위시 연결을 해제하면 위시를 지울 수 있다', async ({ page }) => {
  const api = await userClient(accounts.a);
  const wishTitle = uniqueTitle('연결 해제 위시');
  const wishId = await apiCreateWish(api, wishTitle);
  const eventId = await apiCreateEvent(api, {
    title: uniqueTitle('연결 해제 일정'),
    startDate: DAY,
    startTime: '18:00',
    wishItemId: wishId,
  });

  // 먼저 거부되는 것을 확인한다.
  expect((await apiDeleteWish(api, wishId, 1)).ok).toBe(false);

  await login(page, accounts.a);
  await page.goto(`/calendar/${eventId}/edit`);
  await expect(page.getByRole('heading', { name: '일정 수정' })).toBeVisible();
  await page.getByLabel('위시 연결').selectOption({ label: '연결 없음' });
  await page.getByRole('button', { name: '변경 저장' }).click();

  await expect(page.getByTestId('event-linked-wish')).toContainText('연결한 위시가 없어요.');
  expect((await apiEvent(api, eventId))?.wish_item_id).toBeNull();

  const removed = await apiDeleteWish(api, wishId, 1);
  expect(removed.ok).toBe(true);
  expect(await apiWishExists(api, wishId)).toBe(false);
});

test('연결된 일정을 지우면 위시를 지울 수 있다(위시는 함께 지워지지 않는다)', async ({ page }) => {
  const api = await userClient(accounts.a);
  const wishId = await apiCreateWish(api, uniqueTitle('일정 삭제 후 위시'));
  const eventId = await apiCreateEvent(api, {
    title: uniqueTitle('지울 일정'),
    startDate: DAY,
    startTime: '19:00',
    wishItemId: wishId,
  });

  await login(page, accounts.a);
  await gotoDetail(page, eventId);
  await page.getByRole('button', { name: '일정 삭제' }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('heading', { name: '커플 캘린더', exact: true })).toBeVisible();

  // 일정만 사라지고 위시는 남는다.
  expect(await apiEvent(api, eventId)).toBeNull();
  expect(await apiWishExists(api, wishId)).toBe(true);

  // 이제 위시를 지울 수 있다.
  expect((await apiDeleteWish(api, wishId, 1)).ok).toBe(true);
});

test('연결하려던 위시가 방금 사라졌으면 확정 실패로 알린다', async () => {
  const api = await userClient(accounts.a);
  const wishId = await apiCreateWish(api, uniqueTitle('사라질 위시'));
  expect((await apiDeleteWish(api, wishId, 1)).ok).toBe(true);

  // 이미 없는 위시에 연결을 시도한다. 존재 여부를 알리지 않는 NOT_FOUND다.
  const result = await callRpc(api, 'save_calendar_event', {
    ...eventArgs({
      title: uniqueTitle('사라진 위시 연결'),
      startDate: DAY,
      startTime: '20:00',
      wishItemId: wishId,
    }),
    p_request_id: newRequestId(),
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe('GF404');
});
