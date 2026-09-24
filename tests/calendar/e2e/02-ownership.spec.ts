import { expect, test } from '@playwright/test';

import {
  apiEvent,
  callRpc,
  createEventViaUi,
  eventArgs,
  gotoDetail,
  gotoMonth,
  loadCalendarAccounts,
  login,
  monthOf,
  newRequestId,
  stableMonthDay,
  uniqueTitle,
  userClient,
} from './helpers';

/**
 * 개인 일정의 소유권(DESIGN 6, PROJECT_PLAN 8).
 *
 *   - 두 사람 모두 **조회**한다. 상대 개인 일정도 달력과 상세에서 볼 수 있다.
 *   - **변경은 소유자만** 한다. 상대가 시도하면 화면에도 버튼이 없고 DB도 FORBIDDEN으로 거부한다.
 *   - 화면 버튼을 숨기는 것으로 검증을 대신하지 않는다(DESIGN 12). 직접 RPC까지 확인한다.
 *   - 개인 일정의 소유자는 언제나 **만든 사람**이다. 상대를 소유자로 지정할 수 없다.
 */

const accounts = loadCalendarAccounts();

test.describe.configure({ mode: 'serial' });

const DAY = stableMonthDay(8);
const MONTH = monthOf(DAY);

let personalOfA = '';
let titleOfA = '';

test('A의 개인 일정은 소유자가 A다', async ({ page }) => {
  await login(page, accounts.a);
  titleOfA = uniqueTitle('A 치과');

  personalOfA = await createEventViaUi(page, {
    title: titleOfA,
    kind: 'personal',
    startDate: DAY,
    startTime: '11:00',
  });

  const api = await userClient(accounts.a);
  const row = await apiEvent(api, personalOfA);
  expect(row?.kind).toBe('personal');
  expect(row?.owner_id).toBe(accounts.a.userId);
  expect(row?.created_by).toBe(accounts.a.userId);
});

test('B는 A의 개인 일정을 볼 수 있다', async ({ page }) => {
  await login(page, accounts.b);

  await gotoMonth(page, MONTH);
  const cell = page.locator(`[data-testid="calendar-day"][data-date="${DAY}"]`);
  await expect(cell.getByTestId('calendar-day-event').filter({ hasText: titleOfA })).toHaveCount(1);

  await gotoDetail(page, personalOfA);
  await expect(page.getByRole('heading', { name: titleOfA })).toBeVisible();
});

test('B의 화면에는 A 개인 일정의 수정·삭제·완료 버튼이 없다', async ({ page }) => {
  await login(page, accounts.b);
  await gotoDetail(page, personalOfA);

  await expect(page.getByTestId('event-readonly-notice')).toBeVisible();
  await expect(page.getByRole('link', { name: '내용 수정' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '일정 삭제' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '완료로 바꾸기' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '취소로 바꾸기' })).toHaveCount(0);
});

test('B가 수정 주소로 직접 들어가도 폼이 나오지 않는다', async ({ page }) => {
  await login(page, accounts.b);
  await page.goto(`/calendar/${personalOfA}/edit`);

  // 안내는 ErrorNotice(제목은 문단)로 그린다. 폼은 아예 렌더하지 않는다.
  await expect(page.getByText('이 일정은 고칠 수 없어요')).toBeVisible();
  await expect(page.getByLabel('제목')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '변경 저장' })).toHaveCount(0);
});

test('B의 직접 RPC는 FORBIDDEN이고 아무것도 바꾸지 않는다', async () => {
  const api = await userClient(accounts.b);

  const edited = await callRpc(api, 'save_calendar_event', {
    ...eventArgs(
      { title: 'B가 가로채기', kind: 'personal', startDate: DAY, startTime: '11:00' },
      { eventId: personalOfA, expectedVersion: 1 },
    ),
    p_request_id: newRequestId(),
  });
  expect(edited.ok).toBe(false);
  if (!edited.ok) expect(edited.code).toBe('GF403');

  const status = await callRpc(api, 'set_calendar_event_status', {
    p_event_id: personalOfA,
    p_status: 'done',
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(status.ok).toBe(false);
  if (!status.ok) expect(status.code).toBe('GF403');

  const removed = await callRpc(api, 'delete_calendar_event', {
    p_event_id: personalOfA,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(removed.ok).toBe(false);
  if (!removed.ok) expect(removed.code).toBe('GF403');

  // 거부된 요청은 버전도 올리지 않는다.
  const owner = await userClient(accounts.a);
  const row = await apiEvent(owner, personalOfA);
  expect(row?.title).toBe(titleOfA);
  expect(row?.status).toBe('scheduled');
  expect(row?.version).toBe(1);
});

test('A는 자기 개인 일정을 고치고 완료 체크한다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoDetail(page, personalOfA);

  await expect(page.getByTestId('event-readonly-notice')).toHaveCount(0);
  await page.getByRole('button', { name: '완료로 바꾸기' }).click();
  await expect(page.getByText('완료로 표시했어요.')).toBeVisible();

  const api = await userClient(accounts.a);
  expect((await apiEvent(api, personalOfA))?.status).toBe('done');
});

test('개인 일정을 공동 일정으로 바꿀 수 없다(종류는 불변)', async ({ page }) => {
  await login(page, accounts.a);
  await page.goto(`/calendar/${personalOfA}/edit`);
  await expect(page.getByRole('heading', { name: '일정 수정' })).toBeVisible();

  // 화면에서는 종류 선택을 잠근다.
  await expect(page.getByLabel('일정 종류')).toBeDisabled();

  // 직접 RPC로 우회해도 DB가 막는다.
  const api = await userClient(accounts.a);
  const row = await apiEvent(api, personalOfA);
  const result = await callRpc(api, 'save_calendar_event', {
    ...eventArgs(
      { title: titleOfA, kind: 'date', startDate: DAY, startTime: '11:00' },
      { eventId: personalOfA, expectedVersion: row!.version },
    ),
    p_request_id: newRequestId(),
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe('GF422');

  expect((await apiEvent(api, personalOfA))?.kind).toBe('personal');
  expect((await apiEvent(api, personalOfA))?.owner_id).toBe(accounts.a.userId);
});

test('B가 만든 개인 일정의 소유자는 B이고 A가 바꿀 수 없다', async ({ page }) => {
  await login(page, accounts.b);
  const titleOfB = uniqueTitle('B 야근');
  const personalOfB = await createEventViaUi(page, {
    title: titleOfB,
    kind: 'personal',
    startDate: stableMonthDay(9),
    startTime: '19:00',
  });

  const apiB = await userClient(accounts.b);
  expect((await apiEvent(apiB, personalOfB))?.owner_id).toBe(accounts.b.userId);

  const apiA = await userClient(accounts.a);
  const status = await callRpc(apiA, 'set_calendar_event_status', {
    p_event_id: personalOfB,
    p_status: 'cancelled',
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(status.ok).toBe(false);
  if (!status.ok) expect(status.code).toBe('GF403');
  expect((await apiEvent(apiA, personalOfB))?.status).toBe('scheduled');
});

test('A는 자기 개인 일정을 지울 수 있다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoDetail(page, personalOfA);

  await page.getByRole('button', { name: '일정 삭제' }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('heading', { name: '커플 캘린더', exact: true })).toBeVisible();

  const api = await userClient(accounts.a);
  expect(await apiEvent(api, personalOfA)).toBeNull();
});
