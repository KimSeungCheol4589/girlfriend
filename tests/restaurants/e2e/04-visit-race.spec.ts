import { expect, test } from '@playwright/test';

import {
  apiCreateRestaurant,
  apiRestaurant,
  apiReviews,
  apiSetVisited,
  callRpc,
  gotoDetail,
  loadFoodAccounts,
  login,
  newRequestId,
  seoulDateDaysAgo,
  uniqueName,
  userClient,
} from './helpers';

/**
 * 방문 취소·삭제와 후기 작성의 경쟁(DESIGN 5.3, 12 "방문 취소와 후기 작성 동시 실행").
 *
 * 불변식: wishlist 맛집에는 후기가 남지 않는다. 확인 없이 보낸 취소·삭제는 후기를 지우지 않는다.
 *
 * 한계: 여기서는 두 요청을 동시에 보내지만 DB 안에서 잠금 경쟁이 실제로 겹쳤는지는 보장하지 않는다.
 * 겹침을 강제한 결정적 검증은 supabase/tests/food001_concurrency/run_food_race_tests.sh가 한다.
 * 여기서는 어떤 순서로 처리되든 불변식이 지켜지는지를 여러 번 반복해 확인한다.
 */

const accounts = loadFoodAccounts();

test.describe.configure({ mode: 'serial' });

test('API: 확인 없는 방문 취소 vs 상대 후기 작성 — 정확히 하나만 성공하고 불변식이 유지된다', async () => {
  const apiA = await userClient(accounts.a);
  const apiB = await userClient(accounts.b);

  for (let round = 0; round < 8; round += 1) {
    const id = await apiCreateRestaurant(apiA, { name: uniqueName(`경쟁${round}`) });
    await apiSetVisited(apiA, id, 1, seoulDateDaysAgo(1));

    const [revert, review] = await Promise.all([
      callRpc(apiA, 'set_restaurant_status', {
        p_restaurant_id: id,
        p_status: 'wishlist',
        p_visited_date: null,
        p_confirm_delete_reviews: false,
        p_expected_version: 2,
        p_request_id: newRequestId(),
      }),
      callRpc(apiB, 'save_review', {
        p_restaurant_id: id,
        p_rating: 5,
        p_comment: `B 후기 ${round}`,
        p_expected_version: 0,
        p_request_id: newRequestId(),
      }),
    ]);

    expect(Number(revert.ok) + Number(review.ok), `round ${round}: 정확히 하나만 성공`).toBe(1);
    if (!revert.ok) {
      // 후기가 먼저 커밋되면 맛집 버전이 올라가 A의 expectedVersion(2)이 낡는다.
      expect(revert.code).toBe('GF409');
      expect(revert.details).toContain('expectedVersion');
    }
    if (!review.ok) {
      expect(review.code).toBe('GF409');
      expect(review.details).toContain('not_visited');
    }

    const row = await apiRestaurant(apiA, id);
    const reviews = await apiReviews(apiA, id);
    if (row?.status === 'wishlist') {
      expect(reviews, `round ${round}: wishlist에는 후기가 없다`).toHaveLength(0);
      expect(row.visited_date).toBeNull();
    } else {
      expect(row?.status).toBe('visited');
      expect(reviews).toHaveLength(1);
    }
  }
});

test('API: 확인된 방문 취소 vs 후기 작성 — 확인 뒤 생긴 후기를 지우지 않고, wishlist에 후기가 남지 않는다', async () => {
  const apiA = await userClient(accounts.a);
  const apiB = await userClient(accounts.b);

  for (let round = 0; round < 8; round += 1) {
    const id = await apiCreateRestaurant(apiA, { name: uniqueName(`확인경쟁${round}`) });
    await apiSetVisited(apiA, id, 1, seoulDateDaysAgo(1));

    const [revert, review] = await Promise.all([
      callRpc(apiA, 'set_restaurant_status', {
        p_restaurant_id: id,
        p_status: 'wishlist',
        p_visited_date: null,
        p_confirm_delete_reviews: true,
        p_expected_version: 2,
        p_request_id: newRequestId(),
      }),
      callRpc(apiB, 'save_review', {
        p_restaurant_id: id,
        p_rating: 1,
        p_comment: `B 후기 ${round}`,
        p_expected_version: 0,
        p_request_id: newRequestId(),
      }),
    ]);

    // 확인 플래그가 있어도 A가 본 버전(2) 이후에 생긴 후기는 지우지 않는다: 정확히 하나만 성공한다.
    expect(Number(revert.ok) + Number(review.ok), `round ${round}: 정확히 하나만 성공`).toBe(1);
    const row = await apiRestaurant(apiA, id);
    const reviews = await apiReviews(apiA, id);
    if (revert.ok) {
      expect(row?.status).toBe('wishlist');
      expect(reviews).toHaveLength(0);
      if (!review.ok) expect(review.details).toContain('not_visited');
    } else {
      expect(revert.code).toBe('GF409');
      expect(revert.details).toContain('expectedVersion');
      expect(row?.status).toBe('visited');
      expect(reviews).toHaveLength(1);
    }
  }
});

test('API: 확인 없는 삭제 vs 후기 작성 — 후기가 조용히 지워지지 않는다', async () => {
  const apiA = await userClient(accounts.a);
  const apiB = await userClient(accounts.b);

  for (let round = 0; round < 6; round += 1) {
    const id = await apiCreateRestaurant(apiA, { name: uniqueName(`삭제경쟁${round}`) });
    await apiSetVisited(apiA, id, 1, seoulDateDaysAgo(1));

    const [removed, review] = await Promise.all([
      callRpc(apiA, 'delete_restaurant_confirmed', {
        p_restaurant_id: id,
        p_confirm_delete_reviews: false,
        p_expected_version: 2,
        p_request_id: newRequestId(),
      }),
      callRpc(apiB, 'save_review', {
        p_restaurant_id: id,
        p_rating: 4,
        p_comment: `B 후기 ${round}`,
        p_expected_version: 0,
        p_request_id: newRequestId(),
      }),
    ]);

    const row = await apiRestaurant(apiA, id);
    if (removed.ok) {
      // 삭제가 먼저 → 후기 저장은 대상 없음
      expect(row).toBeNull();
      expect(review.ok).toBe(false);
    } else {
      // 후기가 먼저 → 확인 없는 삭제는 거부, 후기 유지
      expect(removed.code).toBe('GF409');
      expect(review.ok).toBe(true);
      expect(row).not.toBeNull();
      expect(await apiReviews(apiA, id)).toHaveLength(1);
    }
  }
});

test('화면: 방문 취소 창을 연 사이 상대가 후기를 쓰면, 아무것도 지우지 않고 다시 확인을 받는다', async ({ page }) => {
  await login(page, accounts.a);
  const apiA = await userClient(accounts.a);
  const apiB = await userClient(accounts.b);
  const id = await apiCreateRestaurant(apiA, { name: uniqueName('화면경쟁') });
  await apiSetVisited(apiA, id, 1, seoulDateDaysAgo(3));

  await gotoDetail(page, id);
  await expect(page.getByText('아직 상대방 후기가 없어요.')).toBeVisible();

  // A 화면에는 후기가 없는 상태에서 B가 후기를 쓴다
  const byB = await callRpc(apiB, 'save_review', {
    p_restaurant_id: id,
    p_rating: 5,
    p_comment: 'B가 방금 쓴 후기',
    p_expected_version: 0,
    p_request_id: newRequestId(),
  });
  expect(byB.ok).toBe(true);

  // A: 화면상 후기가 없으니 확인 창 없이 요청 → 후기가 맛집 버전을 올렸으므로 DB가 CONFLICT로 거부
  await page.getByRole('button', { name: '가고 싶은 곳으로 되돌리기' }).click();
  await expect(page.getByText(/확인한 뒤에 맛집 정보나 후기가 바뀌어 아무것도 바꾸지 않았어요/)).toBeVisible();
  expect((await apiRestaurant(apiA, id))?.status).toBe('visited');
  expect(await apiReviews(apiA, id)).toHaveLength(1);

  // 최신 내용이 그려지면 B 후기가 보이고, 다시 누르면 삭제될 후기를 보여 주는 확인 창이 뜬다
  await expect(page.getByTestId('partner-review')).toContainText('B가 방금 쓴 후기');
  await page.getByRole('button', { name: '가고 싶은 곳으로 되돌리기' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('후기 1개가 삭제돼요');
  await expect(dialog).toContainText('B가 방금 쓴 후기');

  // 취소하면 아무것도 바뀌지 않는다
  await dialog.getByRole('button', { name: '취소' }).click();
  expect((await apiRestaurant(apiA, id))?.status).toBe('visited');

  await page.getByRole('button', { name: '가고 싶은 곳으로 되돌리기' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '후기 1개 삭제하고 되돌리기' }).click();
  await expect(page.getByText('가고 싶은 곳으로 되돌리고 후기 1개를 삭제했어요.')).toBeVisible();

  const row = await apiRestaurant(apiA, id);
  expect(row?.status).toBe('wishlist');
  expect(row?.visited_date).toBeNull();
  expect(await apiReviews(apiA, id)).toHaveLength(0);
});

test('화면: 삭제 창을 연 사이 상대가 후기를 쓰면, 후기를 지우지 않고 다시 확인을 받는다', async ({ page }) => {
  await login(page, accounts.a);
  const apiA = await userClient(accounts.a);
  const apiB = await userClient(accounts.b);
  const id = await apiCreateRestaurant(apiA, { name: uniqueName('삭제화면경쟁') });
  await apiSetVisited(apiA, id, 1, seoulDateDaysAgo(3));

  await gotoDetail(page, id);
  await page.getByRole('button', { name: '맛집 삭제' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('연결된 후기는 없어요');

  const byB = await callRpc(apiB, 'save_review', {
    p_restaurant_id: id,
    p_rating: 2,
    p_comment: '삭제 직전 후기',
    p_expected_version: 0,
    p_request_id: newRequestId(),
  });
  expect(byB.ok).toBe(true);

  await page.getByRole('alertdialog').getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByText(/확인한 뒤에 맛집 정보나 후기가 바뀌어 아무것도 바꾸지 않았어요/)).toBeVisible();
  expect(await apiRestaurant(apiA, id)).not.toBeNull();
  expect(await apiReviews(apiA, id)).toHaveLength(1);

  await expect(page.getByTestId('partner-review')).toContainText('삭제 직전 후기');
  await page.getByRole('button', { name: '맛집 삭제' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('후기 1개도 함께 삭제돼요');
  await page.getByRole('alertdialog').getByRole('button', { name: '후기 1개와 함께 삭제' }).click();
  await expect(page.getByRole('heading', { name: '맛집', exact: true })).toBeVisible();
  expect(await apiRestaurant(apiA, id)).toBeNull();
});

test('화면: 삭제 확인 창에 보인 후기를 상대가 고치면, 확인했어도 지우지 않고 바뀐 후기로 다시 확인을 받는다', async ({ page }) => {
  await login(page, accounts.a);
  const apiA = await userClient(accounts.a);
  const apiB = await userClient(accounts.b);
  const id = await apiCreateRestaurant(apiA, { name: uniqueName('수정경쟁') });
  await apiSetVisited(apiA, id, 1, seoulDateDaysAgo(3));
  const created = await callRpc(apiB, 'save_review', {
    p_restaurant_id: id,
    p_rating: 3,
    p_comment: 'B 원래 후기',
    p_expected_version: 0,
    p_request_id: newRequestId(),
  });
  expect(created.ok).toBe(true);

  await gotoDetail(page, id);
  await page.getByRole('button', { name: '맛집 삭제' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('B 원래 후기');

  // 확인 창이 열린 채로 B가 후기를 고친다(후기 수는 그대로 1개)
  const edited = await callRpc(apiB, 'save_review', {
    p_restaurant_id: id,
    p_rating: 5,
    p_comment: 'B가 고친 소중한 후기',
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(edited.ok).toBe(true);

  await page.getByRole('alertdialog').getByRole('button', { name: '후기 1개와 함께 삭제' }).click();
  await expect(page.getByText(/확인한 뒤에 맛집 정보나 후기가 바뀌어 아무것도 바꾸지 않았어요/)).toBeVisible();
  expect(await apiRestaurant(apiA, id)).not.toBeNull();
  expect((await apiReviews(apiA, id)).map((review) => review.comment)).toEqual(['B가 고친 소중한 후기']);

  // 새로 그려진 확인 창에는 고친 후기가 보이고, 그 확인으로만 지운다
  await expect(page.getByTestId('partner-review')).toContainText('B가 고친 소중한 후기');
  await page.getByRole('button', { name: '맛집 삭제' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('B가 고친 소중한 후기');
  await page.getByRole('alertdialog').getByRole('button', { name: '후기 1개와 함께 삭제' }).click();
  await expect(page.getByRole('heading', { name: '맛집', exact: true })).toBeVisible();
  expect(await apiRestaurant(apiA, id)).toBeNull();
});
