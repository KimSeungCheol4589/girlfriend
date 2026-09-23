import { expect, test } from '@playwright/test';

import {
  anonClient,
  apiCreateRestaurant,
  apiRestaurant,
  apiReviews,
  apiSetVisited,
  callRpc,
  gotoRestaurants,
  loadFoodAccounts,
  login,
  newRequestId,
  seoulDateDaysAgo,
  uniqueName,
  userClient,
  waitForScreen,
} from './helpers';

/**
 * 접근 제어 — 화면 버튼을 숨기는 것만으로 대신하지 않는다(DESIGN 12).
 * 비로그인·외부 공간 계정(C)·같은 공간의 상대(B)가 **직접 API**로 시도해도 막히는지 본다.
 */

const accounts = loadFoodAccounts();

test.describe.configure({ mode: 'serial' });

let restaurantId = '';
let reviewA = '';
let reviewAVersion = 0;
const name = uniqueName('접근');

test.beforeAll(async () => {
  const apiA = await userClient(accounts.a);
  restaurantId = await apiCreateRestaurant(apiA, { name, memo: 'A 공간 메모' });
  await apiSetVisited(apiA, restaurantId, 1, seoulDateDaysAgo(1));
  const saved = await callRpc(apiA, 'save_review', {
    p_restaurant_id: restaurantId,
    p_rating: 4,
    p_comment: 'A의 후기',
    p_expected_version: 0,
    p_request_id: newRequestId(),
  });
  if (!saved.ok) throw new Error(`준비 실패 code=${saved.code}`);
  reviewA = String(saved.data.reviewId);
  reviewAVersion = Number(saved.data.version);
});

async function snapshot() {
  const apiA = await userClient(accounts.a);
  return { restaurant: await apiRestaurant(apiA, restaurantId), reviews: await apiReviews(apiA, restaurantId) };
}

test('비로그인: 화면은 로그인으로 보내고, API 조회·변경은 모두 거부된다', async ({ page }) => {
  await page.goto('/restaurants');
  await waitForScreen(page, ['login']);
  await expect(page).toHaveURL(/\/login\?next=%2Frestaurants$/);

  await page.goto(`/restaurants/${restaurantId}`);
  await waitForScreen(page, ['login']);

  const anon = anonClient();
  const select = await anon.from('restaurants').select('id').eq('id', restaurantId);
  expect(select.error !== null || (select.data ?? []).length === 0).toBe(true);
  const reviews = await anon.from('restaurant_reviews').select('id').eq('restaurant_id', restaurantId);
  expect(reviews.error !== null || (reviews.data ?? []).length === 0).toBe(true);

  for (const [fn, args] of [
    ['save_restaurant', { p_restaurant_id: restaurantId, p_name: 'x', p_area: '', p_category: '', p_map_url: null, p_memo: '', p_expected_version: 2, p_request_id: newRequestId() }],
    ['delete_restaurant_confirmed', { p_restaurant_id: restaurantId, p_confirm_delete_reviews: true, p_expected_version: 2, p_request_id: newRequestId() }],
    ['save_review', { p_restaurant_id: restaurantId, p_rating: 1, p_comment: 'x', p_expected_version: 0, p_request_id: newRequestId() }],
  ] as const) {
    const outcome = await callRpc(anon, fn, args);
    expect(outcome.ok, `${fn}는 비로그인에게 거부돼야 한다`).toBe(false);
  }

  const after = await snapshot();
  expect(after.restaurant?.name).toBe(name);
  expect(after.reviews).toHaveLength(1);
});

test('외부 공간 계정 C: 목록에 없고 상세는 404, 직접 API 변경은 NOT_FOUND', async ({ page }) => {
  await login(page, accounts.c);
  await gotoRestaurants(page, `?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole('heading', { name: '조건에 맞는 맛집이 없어요' })).toBeVisible();

  await page.goto(`/restaurants/${restaurantId}`);
  await expect(page.getByRole('heading', { name: '이 맛집을 찾지 못했어요' })).toBeVisible();
  await page.goto(`/restaurants/${restaurantId}/edit`);
  await expect(page.getByRole('heading', { name: '이 맛집을 찾지 못했어요' })).toBeVisible();

  const apiC = await userClient(accounts.c);
  expect((await apiC.from('restaurants').select('id').eq('id', restaurantId)).data ?? []).toHaveLength(0);
  expect((await apiC.from('restaurant_reviews').select('id').eq('restaurant_id', restaurantId)).data ?? []).toHaveLength(0);

  const attempts = [
    ['save_restaurant', { p_restaurant_id: restaurantId, p_name: 'C가 바꿈', p_area: '', p_category: '', p_map_url: null, p_memo: '', p_expected_version: 2, p_request_id: newRequestId() }],
    ['set_restaurant_status', { p_restaurant_id: restaurantId, p_status: 'wishlist', p_visited_date: null, p_confirm_delete_reviews: true, p_expected_version: 2, p_request_id: newRequestId() }],
    ['delete_restaurant_confirmed', { p_restaurant_id: restaurantId, p_confirm_delete_reviews: true, p_expected_version: 2, p_request_id: newRequestId() }],
    ['save_review', { p_restaurant_id: restaurantId, p_rating: 1, p_comment: '침입', p_expected_version: 0, p_request_id: newRequestId() }],
    ['delete_review', { p_review_id: reviewA, p_expected_version: reviewAVersion, p_request_id: newRequestId() }],
  ] as const;
  for (const [fn, args] of attempts) {
    const outcome = await callRpc(apiC, fn, args);
    expect(outcome.ok, `${fn}는 C에게 거부돼야 한다`).toBe(false);
    if (!outcome.ok) expect(outcome.code, `${fn}는 존재 여부를 숨기는 GF404여야 한다`).toBe('GF404');
  }

  const after = await snapshot();
  expect(after.restaurant?.name).toBe(name);
  expect(after.restaurant?.status).toBe('visited');
  expect(after.reviews.map((review) => review.comment)).toEqual(['A의 후기']);
});

test('같은 공간의 B도 A의 후기는 직접 API로 바꾸거나 지울 수 없다', async () => {
  const apiB = await userClient(accounts.b);

  // B는 A의 후기를 볼 수는 있다.
  expect((await apiReviews(apiB, restaurantId)).map((review) => review.comment)).toEqual(['A의 후기']);

  // RPC로 A 후기 삭제 → 존재를 알리지 않는 NOT_FOUND
  const deleted = await callRpc(apiB, 'delete_review', {
    p_review_id: reviewA,
    p_expected_version: reviewAVersion,
    p_request_id: newRequestId(),
  });
  expect(deleted.ok).toBe(false);
  if (!deleted.ok) expect(deleted.code).toBe('GF404');

  // 테이블 직접 쓰기(INSERT·UPDATE·DELETE) → 권한 거부
  const insert = await apiB.from('restaurant_reviews').insert({
    restaurant_id: restaurantId,
    user_id: accounts.a.userId,
    rating: 1,
    comment: 'A인 척',
  });
  expect(insert.error?.code).toBe('42501');
  const update = await apiB.from('restaurant_reviews').update({ comment: '덮어쓰기' }).eq('id', reviewA);
  expect(update.error?.code).toBe('42501');
  const remove = await apiB.from('restaurant_reviews').delete().eq('id', reviewA);
  expect(remove.error?.code).toBe('42501');
  const direct = await apiB.from('restaurants').update({ name: '직접 수정' }).eq('id', restaurantId);
  expect(direct.error?.code).toBe('42501');

  // save_review는 호출자 본인 후기만 만든다(A 후기는 그대로)
  const own = await callRpc(apiB, 'save_review', {
    p_restaurant_id: restaurantId,
    p_rating: 2,
    p_comment: 'B 본인 후기',
    p_expected_version: 0,
    p_request_id: newRequestId(),
  });
  expect(own.ok).toBe(true);

  // 확인 없는 이전 삭제 함수는 실행 권한이 없다
  const legacy = await callRpc(apiB, 'delete_restaurant', {
    p_restaurant_id: restaurantId,
    p_expected_version: 2,
    p_request_id: newRequestId(),
  });
  expect(legacy.ok).toBe(false);
  if (!legacy.ok) expect(legacy.code).toBe('42501');

  const after = await snapshot();
  expect(after.restaurant).not.toBeNull();
  const byUser = new Map(after.reviews.map((review) => [review.user_id, review.comment]));
  expect(byUser.get(accounts.a.userId ?? '')).toBe('A의 후기');
  expect(byUser.get(accounts.b.userId ?? '')).toBe('B 본인 후기');
});
