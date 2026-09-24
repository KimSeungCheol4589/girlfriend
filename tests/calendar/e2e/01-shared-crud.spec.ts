import { expect, test } from '@playwright/test';

import {
  apiEvent,
  createEventViaUi,
  eventIdFromUrl,
  failOnDialog,
  gotoDetail,
  gotoMonth,
  koreanDate,
  loadCalendarAccounts,
  login,
  logout,
  monthOf,
  seoulParts,
  stableMonthDay,
  uniqueTitle,
  userClient,
} from './helpers';

/**
 * 공동 데이트 일정(owner 없음): 두 사람 모두 만들고 고치고 완료 체크하고 지운다.
 *
 * 함께 확인하는 것
 *   - 서버가 한국 시간으로 시각을 조립한다(브라우저 시간대와 무관하게 같은 날짜로 저장된다).
 *   - 종일 일정의 포함 종료일과 여러 날 걸침.
 *   - 재로그인·상대 계정 로그인 뒤에도 내용이 그대로다.
 *   - 저장한 문자열이 스크립트로 실행되지 않는다.
 */

const accounts = loadCalendarAccounts();

test.describe.configure({ mode: 'serial' });

const DAY = stableMonthDay(12);
const MONTH = monthOf(DAY);

let eventId = '';
let eventTitle = '';

test('A가 시간 일정을 만들면 한국 시간 기준으로 저장된다', async ({ page }) => {
  await login(page, accounts.a);
  eventTitle = uniqueTitle('전시 데이트');

  eventId = await createEventViaUi(page, {
    title: eventTitle,
    kind: 'date',
    startDate: DAY,
    startTime: '14:30',
    endTime: '16:00',
    location: '서울시립미술관',
    note: '예약 필요',
  });

  // 상세 화면이 저장한 내용을 그대로 보여 준다.
  await expect(page.getByTestId('event-when')).toContainText(koreanDate(DAY));
  await expect(page.getByTestId('event-when')).toContainText('오후 2:30');
  await expect(page.getByTestId('event-when')).toContainText('오후 4:00');
  await expect(page.getByText('서울시립미술관')).toBeVisible();
  await expect(page.getByText('예약 필요')).toBeVisible();

  // DB에 저장된 값도 한국 시간으로 같은 날짜·시각이다.
  const api = await userClient(accounts.a);
  const row = await apiEvent(api, eventId);
  expect(row?.kind).toBe('date');
  expect(row?.owner_id).toBeNull();
  expect(row?.status).toBe('scheduled');
  expect(row?.all_day).toBe(false);
  expect(row?.version).toBe(1);
  expect(seoulParts(row!.starts_at)).toEqual({ date: DAY, time: '14:30' });
  expect(seoulParts(row!.ends_at!)).toEqual({ date: DAY, time: '16:00' });
});

test('B의 달력에도 같은 일정이 보인다(월 보기·목록 보기)', async ({ page }) => {
  await login(page, accounts.b);

  await gotoMonth(page, MONTH);
  const cell = page.locator(`[data-testid="calendar-day"][data-date="${DAY}"]`);
  await expect(cell.getByTestId('calendar-day-event').filter({ hasText: eventTitle })).toHaveCount(1);

  await gotoMonth(page, MONTH, '&view=list');
  await expect(page.getByTestId('calendar-list')).toBeVisible();
  await expect(
    page.getByTestId('calendar-list-event').filter({ hasText: eventTitle }),
  ).toHaveCount(1);
});

test('B가 공동 일정을 고치고 완료 체크한다(작성자는 바뀌지 않는다)', async ({ page }) => {
  await login(page, accounts.b);
  await gotoDetail(page, eventId);

  await page.getByRole('link', { name: '내용 수정' }).click();
  await expect(page.getByRole('heading', { name: '일정 수정' })).toBeVisible();
  await page.getByLabel('제목').fill(`${eventTitle} (B 수정)`);
  await page.getByLabel('장소').fill('국립현대미술관');
  await page.getByRole('button', { name: '변경 저장' }).click();

  await expect(page.getByRole('heading', { name: `${eventTitle} (B 수정)` })).toBeVisible();
  await expect(page.getByText('국립현대미술관')).toBeVisible();

  await page.getByRole('button', { name: '완료로 바꾸기' }).click();
  await expect(page.getByText('완료로 표시했어요.')).toBeVisible();

  const api = await userClient(accounts.a);
  const row = await apiEvent(api, eventId);
  expect(row?.status).toBe('done');
  expect(row?.location).toBe('국립현대미술관');
  expect(row?.version).toBe(3);
  // B가 고쳤어도 작성자는 A 그대로다(생성 후 바꿀 수 없는 열).
  expect(row?.created_by).toBe(accounts.a.userId);
});

test('완료 체크는 삭제와 다르다(일정이 남고 예정으로 되돌릴 수 있다)', async ({ page }) => {
  await login(page, accounts.a);
  await gotoDetail(page, eventId);

  await expect(page.getByTestId('event-status')).toContainText('완료');
  await page.getByRole('button', { name: '예정으로 바꾸기' }).click();
  await expect(page.getByText('예정으로 되돌렸어요.')).toBeVisible();

  const api = await userClient(accounts.a);
  expect((await apiEvent(api, eventId))?.status).toBe('scheduled');
  await expect(page.getByTestId('event-status')).toContainText('예정');
});

test('취소한 일정도 지워지지 않고 달력에 남는다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoDetail(page, eventId);

  await page.getByRole('button', { name: '취소로 바꾸기' }).click();
  await expect(page.getByText('취소한 일정으로 표시했어요. 일정은 지워지지 않아요.')).toBeVisible();

  await gotoMonth(page, MONTH);
  await expect(
    page.getByTestId('calendar-day-event').filter({ hasText: `${eventTitle} (B 수정)` }),
  ).toHaveCount(1);

  // 다시 예정으로 되돌려 다음 테스트의 출발점을 맞춘다.
  await gotoDetail(page, eventId);
  await page.getByRole('button', { name: '예정으로 바꾸기' }).click();
  await expect(page.getByText('예정으로 되돌렸어요.')).toBeVisible();
});

test('종일 여러 날 일정은 걸친 날마다 보인다', async ({ page }) => {
  await login(page, accounts.a);
  const tripTitle = uniqueTitle('여행');
  const from = stableMonthDay(20);
  const to = stableMonthDay(22);

  const tripId = await createEventViaUi(page, {
    title: tripTitle,
    kind: 'date',
    allDay: true,
    startDate: from,
    endDate: to,
    location: '강릉',
  });

  await expect(page.getByTestId('event-when')).toContainText('종일');
  await expect(page.getByTestId('event-when')).toContainText(koreanDate(to));

  const api = await userClient(accounts.a);
  const row = await apiEvent(api, tripId);
  expect(row?.all_day).toBe(true);
  // 종일 일정은 KST 자정에 정렬되고 종료일이 포함된다.
  expect(seoulParts(row!.starts_at)).toEqual({ date: from, time: '00:00' });
  expect(seoulParts(row!.ends_at!)).toEqual({ date: to, time: '00:00' });

  await gotoMonth(page, MONTH);
  for (const date of [from, stableMonthDay(21), to]) {
    const cell = page.locator(`[data-testid="calendar-day"][data-date="${date}"]`);
    await expect(
      cell.getByTestId('calendar-day-event').filter({ hasText: tripTitle }),
      `${date} 칸에 여행 일정이 보여야 한다`,
    ).toHaveCount(1);
  }
  // 걸치지 않은 날에는 없다.
  const outside = page.locator(`[data-testid="calendar-day"][data-date="${stableMonthDay(23)}"]`);
  await expect(outside.getByTestId('calendar-day-event').filter({ hasText: tripTitle })).toHaveCount(0);
});

test('로그아웃하고 다시 로그인해도 내용이 그대로다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoDetail(page, eventId);
  await logout(page);

  await login(page, accounts.a);
  await gotoDetail(page, eventId);
  await expect(page.getByRole('heading', { name: `${eventTitle} (B 수정)` })).toBeVisible();
  await expect(page.getByText('국립현대미술관')).toBeVisible();
  await expect(page.getByTestId('event-when')).toContainText(koreanDate(DAY));
});

test('B가 공동 일정을 지우면 두 사람 목록에서 함께 사라진다', async ({ browser }) => {
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await login(pageB, accounts.b);
  await gotoDetail(pageB, eventId);

  await pageB.getByRole('button', { name: '일정 삭제' }).click();
  await pageB.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(pageB.getByRole('heading', { name: '커플 캘린더', exact: true })).toBeVisible();

  const api = await userClient(accounts.a);
  expect(await apiEvent(api, eventId)).toBeNull();

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await login(pageA, accounts.a);
  await gotoMonth(pageA, MONTH);
  await expect(
    pageA.getByTestId('calendar-day-event').filter({ hasText: `${eventTitle} (B 수정)` }),
  ).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

test('저장한 문자열은 텍스트로만 그려진다', async ({ page }) => {
  const dialog = failOnDialog(page);
  await login(page, accounts.a);

  const nasty = `<img src=x onerror=alert(1)> ${uniqueTitle('XSS')}`;
  await page.goto('/calendar/new');
  await expect(page.getByRole('heading', { name: '일정 추가' })).toBeVisible();
  await page.getByLabel('제목').fill(nasty);
  await page.getByLabel('시작 날짜').fill(DAY);
  await page.getByLabel('시작 시각').fill('10:00');
  await page.getByLabel('메모').fill('<script>alert(2)</script>');
  await page.getByRole('button', { name: '일정 등록' }).click();

  await expect(page.getByRole('heading', { name: nasty })).toBeVisible();
  await expect(page.getByText('<script>alert(2)</script>')).toBeVisible();
  // 그려진 문자열이 실제 요소가 되지 않았다.
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(dialog.triggered()).toBe(false);

  // 정리: 이 일정은 다음 테스트에 필요하지 않다.
  const id = eventIdFromUrl(page);
  await page.getByRole('button', { name: '일정 삭제' }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('heading', { name: '커플 캘린더', exact: true })).toBeVisible();
  const api = await userClient(accounts.a);
  expect(await apiEvent(api, id)).toBeNull();
});
