import { expect, test, type Page } from '@playwright/test';

import {
  apiCreateWish,
  apiSetStatus,
  gotoWishes,
  loadWishAccounts,
  login,
  searchCategorySelect,
  searchTitleBox,
  seoulDateInDays,
  userClient,
  waitSearchReady,
} from './helpers';

/**
 * 필터·검색·커서 페이지네이션·뒤로 가기.
 *
 * DESIGN 3: 필터는 URL 검색 매개변수에 담아 뒤로 가기에도 유지한다.
 * 목록은 `created_at DESC, id DESC` 커서로 20개씩 읽는다.
 *
 * 검색 폼은 자바스크립트 없이도 동작하는 GET 폼이라 입력칸을 하이드레이션 전에 막지 않는다.
 * 그래서 각 이동 뒤에 폼이 준비될 때까지 기다린 다음 입력한다(실제 사용 순서와 같다).
 */

const accounts = loadWishAccounts();
const PAGE_SIZE = 20;

test.describe.configure({ mode: 'serial' });

/** 이 스펙 전용 표식. 다른 테스트가 만든 위시와 섞이지 않게 한다. */
const MARK = `F${Date.now().toString(36).slice(-5)}`;

let doneTitle = '';
let plannedTitle = '';
let wishTitle = '';

/** 검색 폼을 제출하고 다음 목록이 준비될 때까지 기다린다. */
async function submitSearch(page: Page): Promise<void> {
  await page.getByRole('button', { name: '찾기' }).click();
  await waitSearchReady(page);
}

test.beforeAll(async () => {
  const api = await userClient(accounts.a);

  wishTitle = `${MARK} 캠핑 가기`;
  await apiCreateWish(api, { title: wishTitle, category: 'activity' });

  plannedTitle = `${MARK} 제주 여행`;
  const plannedId = await apiCreateWish(api, { title: plannedTitle, category: 'trip' });
  await apiSetStatus(api, plannedId, 'planned', seoulDateInDays(20), 1);

  doneTitle = `${MARK} 선물 사기`;
  const doneId = await apiCreateWish(api, { title: doneTitle, category: 'shopping' });
  await apiSetStatus(api, doneId, 'done', seoulDateInDays(-3), 1);
});

test('상태 탭이 URL에 남고 목록을 거른다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoWishes(page);

  await page.getByRole('link', { name: /계획했어요/ }).first().click();
  await expect(page).toHaveURL(/status=planned/);
  await expect(page.getByRole('link', { name: new RegExp(plannedTitle) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(doneTitle) })).toHaveCount(0);
  await expect(page.getByRole('link', { name: new RegExp(wishTitle) })).toHaveCount(0);

  await page.getByRole('link', { name: /해냈어요/ }).first().click();
  await expect(page).toHaveURL(/status=done/);
  await expect(page.getByRole('link', { name: new RegExp(doneTitle) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(plannedTitle) })).toHaveCount(0);
});

test('제목 검색과 분류 필터가 함께 걸리고 URL에 남는다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoWishes(page);

  await searchTitleBox(page).fill(`${MARK} 제주`);
  await searchCategorySelect(page).selectOption('trip');
  await submitSearch(page);

  await expect(page).toHaveURL(/category=trip/);
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByRole('link', { name: new RegExp(plannedTitle) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(wishTitle) })).toHaveCount(0);

  // 조건에 맞는 것이 없으면 빈 목록 안내가 나온다(조회 실패와 구분된다).
  await searchTitleBox(page).fill(`${MARK} 없는제목`);
  await submitSearch(page);
  await expect(page.getByRole('heading', { name: '조건에 맞는 위시가 없어요' })).toBeVisible();
});

test('뒤로 가기로 이전 필터와 입력칸이 함께 돌아온다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoWishes(page, `?q=${encodeURIComponent(`${MARK} 제주`)}&category=trip`);
  await expect(searchTitleBox(page)).toHaveValue(`${MARK} 제주`);

  // 다른 필터로 이동
  await searchTitleBox(page).fill(`${MARK} 캠핑`);
  await searchCategorySelect(page).selectOption('activity');
  await submitSearch(page);
  await expect(page.getByRole('link', { name: new RegExp(wishTitle) })).toBeVisible();

  await page.goBack();
  await waitSearchReady(page);
  await expect(page).toHaveURL(/category=trip/);
  // 목록과 입력칸이 모두 이전 필터여야 한다(브라우저 폼 복원이 끼어들지 않는다).
  await expect(page.getByRole('link', { name: new RegExp(plannedTitle) })).toBeVisible();
  await expect(searchTitleBox(page)).toHaveValue(`${MARK} 제주`);
  await expect(searchCategorySelect(page)).toHaveValue('trip');
});

test('필터 지우기는 기본 주소로 돌아간다', async ({ page }) => {
  await login(page, accounts.a);
  await gotoWishes(page, '?status=done&category=shopping');
  await page.getByRole('link', { name: '필터 지우기' }).click();
  await expect(page).toHaveURL(/\/wishes$/);
  await expect(page.getByRole('link', { name: new RegExp(wishTitle) })).toBeVisible();
});

test('커서 페이지네이션: 더 보기가 중복 없이 다음 쪽을 잇는다', async ({ page }) => {
  const api = await userClient(accounts.a);
  const pageMark = `P${Date.now().toString(36).slice(-5)}`;

  // 한 쪽을 넘기도록 만든다. 전용 표식으로 이 테스트 항목만 보이게 한다.
  const total = PAGE_SIZE + 3;
  for (let i = 0; i < total; i += 1) {
    await apiCreateWish(api, {
      title: `${pageMark} 항목 ${String(i).padStart(2, '0')}`,
      category: 'other',
    });
  }

  await login(page, accounts.a);
  await gotoWishes(page, `?q=${encodeURIComponent(pageMark)}`);

  const items = page.getByTestId('wish-list').getByRole('listitem');
  await expect(items).toHaveCount(PAGE_SIZE);

  await page.getByRole('button', { name: '더 보기' }).click();
  await expect(items).toHaveCount(total);
  await expect(page.getByText('목록 끝이에요.')).toBeVisible();
  await expect(page.getByRole('button', { name: '더 보기' })).toHaveCount(0);

  // 같은 항목이 두 번 붙지 않았는지 제목으로 확인한다.
  const titles = await items.getByRole('heading').allInnerTexts();
  expect(new Set(titles).size).toBe(titles.length);

  // 필터를 바꾸면 목록이 처음부터 다시 시작한다.
  await searchTitleBox(page).fill(`${pageMark} 항목 0`);
  await submitSearch(page);
  await expect(items).toHaveCount(10);
});
