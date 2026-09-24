import { expect, test } from '@playwright/test';

import {
  apiCreateEvent,
  apiCreateWish,
  apiEvent,
  gotoDetail,
  gotoMonth,
  koreanMonth,
  loadCalendarAccounts,
  login,
  stableMonthDay,
  uniqueTitle,
  userClient,
} from './helpers';

/**
 * 독립 검토(2026-09-24) P3 지적에 대한 회귀 테스트.
 *
 * base `53cffcd` → head `8584d94` 검토에서 P0/P1/P2는 없었고, 아래 P3 항목을 고쳤다.
 * 각 테스트는 **고치기 전에 실패하는 동작**을 겨냥한다.
 *
 *   P3-1 상한(100건) 밖의 연결된 위시가 수정 화면에서 빈 칸으로 보였다
 *   P3-2 월 격자의 앞뒤 달 칸에 일부 일정만 나타났다
 *   P3-3 수정 왕복에서 보고 있던 달·보기·필터가 사라졌다
 *   P3-5 상태 변경 직후 표시·버튼이 알림과 어긋났다
 *   P3-6 범위 칩 3개를 모두 고르면 강조가 전부 꺼졌다
 *   P3-7 월 격자에 요일-날짜 연결과 한국어 날짜 라벨이 없었다
 */

const accounts = loadCalendarAccounts();

test.describe.configure({ mode: 'serial' });

test('P3-1 · 위시가 100건을 넘어도 연결된 위시가 수정 화면에 선택된 상태로 보인다', async ({
  page,
}) => {
  const api = await userClient(accounts.a);

  // 먼저 만든(= 가장 오래된) 위시를 일정에 연결한다.
  const linkedTitle = uniqueTitle('상한 밖 위시');
  const linkedWishId = await apiCreateWish(api, linkedTitle);
  const eventId = await apiCreateEvent(api, {
    title: uniqueTitle('상한 밖 위시 연결'),
    startDate: stableMonthDay(11),
    startTime: '10:00',
    wishItemId: linkedWishId,
  });

  // 선택지 상한(100건)보다 많은 **더 새로운** 위시를 만들어 연결된 위시를 목록 밖으로 밀어낸다.
  const filler = Array.from({ length: 105 }, (_, index) => `C1 채움 위시 ${index}`);
  for (let start = 0; start < filler.length; start += 15) {
    await Promise.all(filler.slice(start, start + 15).map((title) => apiCreateWish(api, title)));
  }

  await login(page, accounts.a);
  await page.goto(`/calendar/${eventId}/edit`);
  await expect(page.getByRole('heading', { name: '일정 수정' })).toBeVisible();

  const select = page.getByLabel('위시 연결');
  // 고치기 전: 맞는 option이 없어 아무것도 선택되지 않았다(value === '').
  await expect(select).toHaveValue(linkedWishId);
  await expect(select.locator(`option[value="${linkedWishId}"]`)).toHaveText(linkedTitle);

  // 그대로 저장해도 연결이 유지된다.
  await page.getByRole('button', { name: '변경 저장' }).click();
  await expect(page.getByTestId('event-linked-wish')).toContainText(linkedTitle);
  expect((await apiEvent(api, eventId))?.wish_item_id).toBe(linkedWishId);
});

/**
 * P3-2 · 앞뒤 달 칸.
 *
 * 2027-05-30 ~ 06-02 종일 일정을 쓴다. 두 달의 격자가 서로의 날짜를 칸으로 포함한다.
 *   5월 격자 마지막 주: 05-30, 05-31, 06-01 … 06-05
 *   6월 격자 첫 주:     05-30, 05-31, 06-01 … 06-05
 * 같은 일정이 **각 달의 자기 날짜 칸에만** 보여야 한다.
 */
test('P3-2 · 달을 넘는 일정이 앞뒤 달 칸에는 그려지지 않는다', async ({ page }) => {
  const api = await userClient(accounts.a);
  const title = uniqueTitle('달 넘는 여행');
  await apiCreateEvent(api, {
    title,
    kind: 'date',
    allDay: true,
    startDate: '2027-05-30',
    endDate: '2027-06-02',
  });

  const eventIn = (date: string) =>
    page
      .locator(`[data-testid="calendar-day"][data-date="${date}"]`)
      .getByTestId('calendar-day-event')
      .filter({ hasText: title });

  await login(page, accounts.a);

  await gotoMonth(page, '2027-05');
  // 이번 달 칸에는 보인다.
  await expect(eventIn('2027-05-30')).toHaveCount(1);
  await expect(eventIn('2027-05-31')).toHaveCount(1);
  // 다음 달 칸은 격자에 있지만 일정을 담지 않는다.
  await expect(page.locator('[data-testid="calendar-day"][data-date="2027-06-01"]')).toHaveAttribute(
    'data-in-month',
    'false',
  );
  await expect(eventIn('2027-06-01')).toHaveCount(0);
  await expect(eventIn('2027-06-02')).toHaveCount(0);

  await gotoMonth(page, '2027-06');
  // 6월에서는 반대로 6월 칸에만 보인다.
  await expect(eventIn('2027-06-01')).toHaveCount(1);
  await expect(eventIn('2027-06-02')).toHaveCount(1);
  await expect(page.locator('[data-testid="calendar-day"][data-date="2027-05-30"]')).toHaveAttribute(
    'data-in-month',
    'false',
  );
  await expect(eventIn('2027-05-30')).toHaveCount(0);
  await expect(eventIn('2027-05-31')).toHaveCount(0);
});

test('P3-3 · 수정 왕복에서 보고 있던 달·보기·필터가 유지된다', async ({ page }) => {
  const api = await userClient(accounts.a);
  const title = uniqueTitle('왕복 상태');
  await apiCreateEvent(api, {
    title,
    kind: 'date',
    startDate: '2027-07-15',
    startTime: '13:00',
  });

  await login(page, accounts.a);
  // 이번 달이 아닌 달 + 목록 보기 + 범위 필터로 들어간다.
  await gotoMonth(page, '2027-07', '&view=list&scope=shared');

  await page.getByTestId('calendar-list-event').filter({ hasText: title }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('link', { name: '내용 수정' }).click();
  await expect(page.getByRole('heading', { name: '일정 수정' })).toBeVisible();

  await page.getByLabel('장소').fill('한강 공원');
  await page.getByRole('button', { name: '변경 저장' }).click();

  // 저장 성공 후 상세로 돌아와도 back이 살아 있다.
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page).toHaveURL(/back=/);

  await page.getByRole('link', { name: '캘린더로 돌아가기' }).click();
  // 고치기 전: 이번 달 + 월 보기 + 필터 없음으로 떨어졌다.
  await expect(page.getByTestId('calendar-month')).toHaveText(koreanMonth('2027-07'));
  await expect(page).toHaveURL(/view=list/);
  await expect(page).toHaveURL(/scope=shared/);
  await expect(page.getByTestId('calendar-list')).toBeVisible();
});

test('P3-3 · 수정에서 취소해도 상세와 캘린더 상태가 유지된다', async ({ page }) => {
  const api = await userClient(accounts.a);
  const title = uniqueTitle('취소 왕복');
  const eventId = await apiCreateEvent(api, {
    title,
    kind: 'date',
    startDate: '2027-07-20',
    startTime: '15:00',
  });

  await login(page, accounts.a);
  await gotoMonth(page, '2027-07', '&scope=shared');
  await page.getByTestId('calendar-day-event').filter({ hasText: title }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('link', { name: '내용 수정' }).click();
  await expect(page.getByRole('heading', { name: '일정 수정' })).toBeVisible();
  await page.getByRole('link', { name: '취소', exact: true }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('link', { name: '캘린더로 돌아가기' }).click();
  await expect(page.getByTestId('calendar-month')).toHaveText(koreanMonth('2027-07'));
  await expect(page).toHaveURL(/scope=shared/);

  // 아무것도 바뀌지 않았다.
  expect((await apiEvent(api, eventId))?.version).toBe(1);
});

/**
 * P3-5 · 상태 표시와 버튼 목록이 서로 맞는지.
 *
 * **이 테스트는 고치기 전에도 통과한다.** 그 사실을 숨기지 않고 적어 둔다.
 * App Router는 서버 액션의 재렌더 결과를 **같은 응답**으로 돌려주므로, 고치기 전의 자기모순 창은
 * 한 커밋 경계만큼 짧다. 외부에서 그 창을 결정적으로 관찰할 방법이 없다(제품 코드에 테스트용 지연
 * 고리를 넣지 않는다).
 *
 * 그래서 이 테스트가 지키는 것은 **끝 상태 불변식**이다: 보이는 "지금 상태"의 버튼은 절대 렌더되지
 * 않는다. 표시가 로컬 상태로 굳어 버리는 식의 더 큰 회귀는 여기서 잡힌다.
 * 버튼 목록 규칙 자체는 `nextStatusChoices` 단위 테스트가 결정적으로 고정한다.
 */
test('P3-5 · 상태를 바꾼 뒤 표시·버튼·알림이 서로 맞는다', async ({ page }) => {
  const api = await userClient(accounts.a);
  const eventId = await apiCreateEvent(api, {
    title: uniqueTitle('상태 동기화'),
    startDate: stableMonthDay(13),
    startTime: '16:00',
  });

  await login(page, accounts.a);
  await gotoDetail(page, eventId);
  await expect(page.getByTestId('event-status')).toContainText('예정');
  await expect(page.getByRole('button', { name: '예정으로 바꾸기' })).toHaveCount(0);

  await page.getByRole('button', { name: '완료로 바꾸기' }).click();
  await expect(page.getByText('완료로 표시했어요.')).toBeVisible();
  await expect(page.getByTestId('event-status')).toContainText('완료');
  await expect(page.getByRole('button', { name: '완료로 바꾸기' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '예정으로 바꾸기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '취소로 바꾸기' })).toBeVisible();

  // 이어서 또 바꿔도 같다(서버 재렌더를 기다리지 않고 바로 누른다).
  await page.getByRole('button', { name: '취소로 바꾸기' }).click();
  await expect(page.getByText('취소한 일정으로 표시했어요. 일정은 지워지지 않아요.')).toBeVisible();
  await expect(page.getByTestId('event-status')).toContainText('취소');
  await expect(page.getByRole('button', { name: '취소로 바꾸기' })).toHaveCount(0);
  await expect(page.getByText(/상대방이 먼저 바꾼 내용이 있어/)).toHaveCount(0);

  expect((await apiEvent(api, eventId))?.status).toBe('cancelled');
  expect((await apiEvent(api, eventId))?.version).toBe(3);
});

test('P3-6 · 범위 칩 3개를 모두 고르면 셋 다 강조로 남는다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoMonth(page, stableMonthDay(13).slice(0, 7));

  const chips = ['내 일정', '상대 일정', '함께'] as const;
  const chip = (name: string) => page.getByRole('link', { name, exact: true });

  // 고른 것이 없는 상태도 "셋 다 보여 주는 중"이므로 셋 다 강조한다.
  for (const name of chips) {
    await expect(chip(name)).toHaveAttribute('aria-current', 'true');
  }

  await chip('내 일정').click();
  await expect(page).toHaveURL(/scope=mine/);
  await expect(chip('내 일정')).toHaveAttribute('aria-current', 'true');
  await expect(chip('상대 일정')).not.toHaveAttribute('aria-current', 'true');

  await chip('상대 일정').click();
  await expect(chip('내 일정')).toHaveAttribute('aria-current', 'true');
  await expect(chip('상대 일정')).toHaveAttribute('aria-current', 'true');
  await expect(chip('함께')).not.toHaveAttribute('aria-current', 'true');

  await chip('함께').click();
  // 셋을 모두 고르면 "모두"로 정규화된다. 고치기 전에는 이 순간 강조가 전부 꺼졌다.
  await expect(page).not.toHaveURL(/scope=/);
  for (const name of chips) {
    await expect(chip(name), `${name} 칩이 강조로 남아야 한다`).toHaveAttribute(
      'aria-current',
      'true',
    );
  }
});

test('P3-7 · 월 격자가 표이고 요일 머리글·한국어 날짜 라벨이 있다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoMonth(page, '2027-06');

  // 요일 머리글이 열 머리글이라 각 칸의 요일이 프로그램적으로 연결된다.
  const headers = page.locator('table th[scope="col"]');
  await expect(headers).toHaveCount(7);
  await expect(headers.first()).toHaveText('일');
  await expect(headers.last()).toHaveText('토');

  // 날짜 칸은 표의 셀이다.
  await expect(page.locator('td[data-testid="calendar-day"]').first()).toBeVisible();

  // 날짜 추가 링크가 ISO 원문이 아니라 한국어 날짜·요일을 읽는다. 2027-06-01은 화요일이다.
  await expect(
    page.getByRole('link', { name: '2027년 6월 1일 (화)에 일정 추가' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '2027-06-01에 일정 추가' })).toHaveCount(0);
});
