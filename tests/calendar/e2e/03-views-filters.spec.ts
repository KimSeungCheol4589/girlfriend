import { expect, test } from '@playwright/test';

import {
  apiCreateEvent,
  apiSetStatus,
  gotoCalendar,
  gotoMonth,
  koreanDateWithWeekday,
  koreanMonth,
  loadCalendarAccounts,
  login,
  monthOf,
  stableMonthDay,
  uniqueTitle,
  userClient,
} from './helpers';

/**
 * 월 보기·목록 보기, 달 이동, 범위·상태 필터.
 *
 * DESIGN 3: 필터는 URL 검색 매개변수에 남아 뒤로 가기에도 유지된다.
 * 한 달 단위 조회이므로 "더 보기"가 없다. 대신 달을 옮겨 본다.
 */

const accounts = loadCalendarAccounts();

test.describe.configure({ mode: 'serial' });

const DAY = stableMonthDay(14);
const MONTH = monthOf(DAY);
const OTHER_DAY = stableMonthDay(15);

/**
 * 제목에는 화면의 필터 라벨(`내 일정`·`상대 일정`·`함께`·`완료`)과 겹치는 낱말을 쓰지 않는다.
 * 겹치면 역할 선택자가 필터 링크와 일정 링크를 함께 잡아 무엇을 눌렀는지 알 수 없게 된다.
 */
const titles = {
  mine: uniqueTitle('에이개인'),
  partner: uniqueTitle('비개인'),
  shared: uniqueTitle('둘이함께'),
  done: uniqueTitle('마친일'),
};

test.beforeAll(async () => {
  const apiA = await userClient(accounts.a);
  const apiB = await userClient(accounts.b);

  await apiCreateEvent(apiA, {
    title: titles.mine,
    kind: 'personal',
    startDate: DAY,
    startTime: '09:00',
  });
  await apiCreateEvent(apiB, {
    title: titles.partner,
    kind: 'personal',
    startDate: DAY,
    startTime: '10:00',
  });
  await apiCreateEvent(apiA, {
    title: titles.shared,
    kind: 'date',
    startDate: DAY,
    startTime: '11:00',
  });
  const doneId = await apiCreateEvent(apiA, {
    title: titles.done,
    kind: 'date',
    startDate: OTHER_DAY,
    startTime: '12:00',
  });
  await apiSetStatus(apiA, doneId, 'done', 1);
});

test('월 보기에 그 달의 일정이 모두 보인다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoMonth(page, MONTH);

  const cell = page.locator(`[data-testid="calendar-day"][data-date="${DAY}"]`);
  for (const title of [titles.mine, titles.partner, titles.shared]) {
    await expect(cell.getByTestId('calendar-day-event').filter({ hasText: title })).toHaveCount(1);
  }
});

test('목록 보기는 날짜별로 묶어 보여 준다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoMonth(page, MONTH, '&view=list');

  await expect(page.getByTestId('calendar-list')).toBeVisible();
  for (const title of [titles.mine, titles.partner, titles.shared, titles.done]) {
    await expect(page.getByTestId('calendar-list-event').filter({ hasText: title })).toHaveCount(1);
  }

  // 같은 날 안에서는 시작이 이른 순이다.
  // 같은 날에 다른 일정이 함께 있어도 판단이 흔들리지 않게 **이번 실행의 세 건 사이 순서만** 본다.
  const dayEvents = await page
    .locator(`section[aria-labelledby="day-${DAY}"] [data-testid="calendar-list-event"]`)
    .allInnerTexts();
  const indexOf = (title: string) => dayEvents.findIndex((text) => text.includes(title));
  const mine = indexOf(titles.mine);
  const partner = indexOf(titles.partner);
  const shared = indexOf(titles.shared);

  expect(mine, '09:00 일정이 목록에 있어야 한다').toBeGreaterThanOrEqual(0);
  expect(mine).toBeLessThan(partner);
  expect(partner).toBeLessThan(shared);
});

test('달을 앞뒤로 옮기면 그 달의 일정만 보인다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoMonth(page, MONTH);

  await page.getByRole('link', { name: '다음 달' }).click();
  await expect(page.getByTestId('calendar-month')).not.toHaveText(koreanMonth(MONTH));
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.shared })).toHaveCount(0);

  await page.getByRole('link', { name: '이전 달' }).click();
  await expect(page.getByTestId('calendar-month')).toHaveText(koreanMonth(MONTH));
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.shared })).toHaveCount(1);
});

test('"이번 달" 버튼은 오늘이 든 달로 돌아온다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoMonth(page, MONTH);

  await page.getByRole('link', { name: '이번 달' }).click();
  // 이번 달로 오면 그 버튼은 사라진다(이미 이번 달이므로).
  await expect(page.getByRole('link', { name: '이번 달' })).toHaveCount(0);
});

test('범위 필터가 URL에 남고 뒤로 가기에도 유지된다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoMonth(page, MONTH);

  await page.getByRole('link', { name: '내 일정', exact: true }).click();
  await expect(page).toHaveURL(/scope=mine/);
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.mine })).toHaveCount(1);
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.partner })).toHaveCount(0);
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.shared })).toHaveCount(0);

  await page.getByRole('link', { name: '함께', exact: true }).click();
  await expect(page).toHaveURL(/scope=mine/);
  await expect(page).toHaveURL(/scope=shared/);
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.mine })).toHaveCount(1);
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.shared })).toHaveCount(1);
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.partner })).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(/scope=mine/);
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.shared })).toHaveCount(0);
});

test('상대 일정만 골라 볼 수 있다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoMonth(page, MONTH, '&scope=partner');

  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.partner })).toHaveCount(1);
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.mine })).toHaveCount(0);
  // 고른 범위 칩이 켜진 상태로 보인다.
  await expect(page.getByRole('link', { name: '상대 일정', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
});

test('"상대 일정"은 보는 사람에 따라 달라진다', async ({ page }) => {
  await login(page, accounts.b);
  await gotoMonth(page, MONTH, '&scope=partner');

  // B가 보는 "상대"는 A다.
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.mine })).toHaveCount(1);
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.partner })).toHaveCount(0);
});

test('상태 필터가 동작하고 필터 지우기로 되돌아온다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoMonth(page, MONTH);

  await page.getByRole('link', { name: '✓ 완료' }).click();
  await expect(page).toHaveURL(/status=done/);
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.done })).toHaveCount(1);
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.shared })).toHaveCount(0);

  await page.getByRole('link', { name: '필터 지우기' }).click();
  await expect(page).not.toHaveURL(/status=/);
  await expect(page.getByTestId('calendar-day-event').filter({ hasText: titles.shared })).toHaveCount(1);
});

test('조건에 맞는 일정이 없으면 그렇게 안내한다(빈 목록으로 감추지 않는다)', async ({ page }) => {
  await login(page, accounts.a);
  await gotoMonth(page, MONTH, '&status=cancelled');

  await expect(page.getByRole('heading', { name: '조건에 맞는 일정이 없어요' })).toBeVisible();
  await expect(page.getByRole('link', { name: '필터 지우기' }).first()).toBeVisible();
});

test('일정이 없는 달에는 첫 일정 추가를 권한다', async ({ page }) => {
  await login(page, accounts.a);
  // 일정이 없는 먼 과거 달.
  await gotoMonth(page, '2020-01');

  await expect(page.getByRole('heading', { name: /2020년 1월에는 일정이 없어요/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '첫 일정 추가' })).toBeVisible();
});

test('달력의 날짜를 누르면 그 날짜로 일정 추가 화면이 열린다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoMonth(page, MONTH);

  // 라벨은 한국어 날짜·요일이다(ISO 원문을 읽지 않는다, 독립 검토 P3-7).
  await page.getByRole('link', { name: `${koreanDateWithWeekday(OTHER_DAY)}에 일정 추가` }).click();
  await expect(page.getByRole('heading', { name: '일정 추가' })).toBeVisible();
  await expect(page.getByLabel('시작 날짜')).toHaveValue(OTHER_DAY);

  // 돌아가기는 보고 있던 달을 유지한다.
  await page.getByRole('link', { name: '캘린더로 돌아가기' }).click();
  await expect(page.getByTestId('calendar-month')).toHaveText(koreanMonth(MONTH));
});

test('알 수 없는 달·보기 값은 기본값으로 떨어진다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoCalendar(page, '?month=2026-13&view=week&scope=nobody&status=archived');

  // 오늘이 든 달이 보이고 필터 지우기 링크는 없다(필터가 없으므로).
  await expect(page.getByTestId('calendar-month')).toBeVisible();
  await expect(page.getByRole('link', { name: '필터 지우기' })).toHaveCount(0);
});
