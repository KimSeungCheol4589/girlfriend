import { expect, test, type Page } from '@playwright/test';

import { STALE_EDIT_MESSAGE } from './messages';
import {
  apiCountByName,
  apiCreateRestaurant,
  apiRestaurant,
  callRpc,
  fillRestaurantForm,
  gotoDetail,
  loadFoodAccounts,
  login,
  newRequestId,
  restaurantIdFromUrl,
  uniqueName,
  userClient,
} from './helpers';

/**
 * 버전 충돌·중복 제출·응답 유실 재시도.
 *
 * - 같은 requestId·같은 입력 재전송은 한 번만 반영된다(동시 전송 포함).
 * - 같은 requestId·다른 입력은 거부된다.
 * - 오래된 버전의 저장은 조용히 덮어쓰지 않고, 화면은 입력을 유지한 채 알린다.
 * - 서버는 처리했지만 응답이 유실된 경우, 같은 입력으로 다시 보내면 같은 키가 쓰여 중복 생성이 없다.
 */

const accounts = loadFoodAccounts();

test.describe.configure({ mode: 'serial' });

test('API: 같은 requestId 재전송(순차·동시)은 한 건만 만들고 같은 ID를 돌려준다', async () => {
  const api = await userClient(accounts.a);
  const name = uniqueName('중복');
  const requestId = newRequestId();
  const args = {
    p_restaurant_id: null,
    p_name: name,
    p_area: '',
    p_category: '',
    p_map_url: null,
    p_memo: '',
    p_expected_version: 0,
    p_request_id: requestId,
  };

  const [first, second] = await Promise.all([
    callRpc(api, 'save_restaurant', args),
    callRpc(api, 'save_restaurant', args),
  ]);
  const third = await callRpc(api, 'save_restaurant', args);

  expect(first.ok && second.ok && third.ok).toBe(true);
  if (first.ok && second.ok && third.ok) {
    expect(second.data.restaurantId).toBe(first.data.restaurantId);
    expect(third.data.restaurantId).toBe(first.data.restaurantId);
  }
  expect(await apiCountByName(api, name)).toBe(1);

  const mismatch = await callRpc(api, 'save_restaurant', { ...args, p_name: `${name} 다른 입력` });
  expect(mismatch.ok).toBe(false);
  if (!mismatch.ok) expect(mismatch.code).toBe('GF409');
  expect(await apiCountByName(api, `${name} 다른 입력`)).toBe(0);
});

test('API: 오래된 버전의 수정은 CONFLICT이고 값을 덮어쓰지 않는다', async () => {
  const apiA = await userClient(accounts.a);
  const apiB = await userClient(accounts.b);
  const id = await apiCreateRestaurant(apiA, { name: uniqueName('버전') });

  const byB = await callRpc(apiB, 'save_restaurant', {
    p_restaurant_id: id, p_name: 'B 먼저', p_area: '', p_category: '', p_map_url: null, p_memo: '', p_expected_version: 1, p_request_id: newRequestId(),
  });
  expect(byB.ok).toBe(true);

  const byA = await callRpc(apiA, 'save_restaurant', {
    p_restaurant_id: id, p_name: 'A 나중', p_area: '', p_category: '', p_map_url: null, p_memo: '', p_expected_version: 1, p_request_id: newRequestId(),
  });
  expect(byA.ok).toBe(false);
  if (!byA.ok) expect(byA.code).toBe('GF409');
  expect((await apiRestaurant(apiA, id))?.name).toBe('B 먼저');
});

test('화면: 상대가 먼저 저장하면 입력을 유지한 채 충돌을 알리고, 최신 내용을 불러온 뒤에만 다시 저장한다', async ({ page }) => {
  await login(page, accounts.a);
  const apiA = await userClient(accounts.a);
  const apiB = await userClient(accounts.b);
  const original = uniqueName('충돌');
  const id = await apiCreateRestaurant(apiA, { name: original, memo: '처음 메모' });

  await page.goto(`/restaurants/${id}/edit`);
  await expect(page.getByRole('heading', { name: '맛집 정보 수정' })).toBeVisible();
  await page.getByLabel('메모').fill('A가 쓰던 메모');

  // 그 사이 B가 이름을 바꾼다
  const byB = await callRpc(apiB, 'save_restaurant', {
    p_restaurant_id: id, p_name: `${original} B수정`, p_area: '', p_category: '', p_map_url: null, p_memo: '처음 메모', p_expected_version: 1, p_request_id: newRequestId(),
  });
  expect(byB.ok).toBe(true);

  await page.getByRole('button', { name: '변경 저장' }).click();
  // 문구는 후기 변경도 충돌 원인임을 알린다(FOOD-001 마이그레이션 2 이후 문구).
  await expect(page.getByText(STALE_EDIT_MESSAGE)).toBeVisible();
  // 입력 유지, DB는 B의 값 그대로
  await expect(page.getByLabel('메모')).toHaveValue('A가 쓰던 메모');
  let row = await apiRestaurant(apiA, id);
  expect(row?.name).toBe(`${original} B수정`);
  expect(row?.memo).toBe('처음 메모');

  // 같은 입력으로 다시 눌러도 조용히 덮어쓰지 않는다(기준 버전을 몰래 올리지 않는다)
  // 첫 요청이 끝나 버튼이 다시 눌릴 수 있을 때 누른다(처리 중 비활성화).
  await expect(page.getByRole('button', { name: '변경 저장' })).toBeEnabled();
  await page.getByRole('button', { name: '변경 저장' }).click();
  await expect(page.getByRole('button', { name: '변경 저장' })).toBeEnabled();
  await expect(page.getByText(STALE_EDIT_MESSAGE)).toBeVisible();
  row = await apiRestaurant(apiA, id);
  expect(row?.memo).toBe('처음 메모');

  // 최신 내용 불러오기 → B의 이름이 폼에 들어오고, 그 뒤 저장은 성공
  await page.getByRole('button', { name: /최신 내용 불러오기/ }).click();
  await expect(page.getByLabel('이름')).toHaveValue(`${original} B수정`);
  await page.getByLabel('메모').fill('A가 다시 쓴 메모');
  await page.getByRole('button', { name: '변경 저장' }).click();
  await expect(page.getByRole('heading', { name: `${original} B수정` })).toBeVisible();
  row = await apiRestaurant(apiA, id);
  expect(row?.memo).toBe('A가 다시 쓴 메모');
  expect(row?.version).toBe(3);
});

test('화면: 정보 수정 중 상대가 후기를 쓰면(맛집 버전 증가) 정보 저장도 충돌로 알리고 덮어쓰지 않는다', async ({ page }) => {
  await login(page, accounts.a);
  const apiA = await userClient(accounts.a);
  const apiB = await userClient(accounts.b);
  const id = await apiCreateRestaurant(apiA, { name: uniqueName('후기충돌'), memo: '원래 메모' });
  const visited = await callRpc(apiA, 'set_restaurant_status', {
    p_restaurant_id: id, p_status: 'visited', p_visited_date: null, p_confirm_delete_reviews: false, p_expected_version: 1, p_request_id: newRequestId(),
  });
  expect(visited.ok).toBe(true);

  await page.goto(`/restaurants/${id}/edit`);
  await expect(page.getByRole('heading', { name: '맛집 정보 수정' })).toBeVisible();
  await page.getByLabel('메모').fill('A가 고치던 메모');

  const review = await callRpc(apiB, 'save_review', {
    p_restaurant_id: id, p_rating: 4, p_comment: 'B 후기', p_expected_version: 0, p_request_id: newRequestId(),
  });
  expect(review.ok).toBe(true);
  if (review.ok) expect(review.data.restaurantVersion).toBe(3);

  await page.getByRole('button', { name: '변경 저장' }).click();
  await expect(page.getByText(STALE_EDIT_MESSAGE)).toBeVisible();
  await expect(page.getByLabel('메모')).toHaveValue('A가 고치던 메모');
  expect((await apiRestaurant(apiA, id))?.memo).toBe('원래 메모');
});

test('화면: 서버는 처리했지만 응답이 유실되면, 같은 입력으로 다시 보내도 한 건만 생긴다', async ({ page }) => {
  await login(page, accounts.a);
  const api = await userClient(accounts.a);
  const name = uniqueName('응답유실');

  await page.goto('/restaurants/new');
  await fillRestaurantForm(page, { name, area: '연남' });

  // 첫 Server Action 요청만: 서버로 실제 전달(route.fetch)한 뒤 브라우저에는 실패로 돌려준다.
  let dropped = 0;
  await page.route('**/restaurants/new', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.headers()['next-action'] && dropped === 0) {
      dropped += 1;
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.getByRole('button', { name: '맛집 등록' }).click();
  await expect(page.getByText(/저장됐는지 확인하지 못했어요/)).toBeVisible();
  expect(dropped).toBe(1);
  // 서버에는 이미 한 건이 저장됐다
  expect(await apiCountByName(api, name)).toBe(1);

  // 입력을 바꾸지 않고 다시 누른다 → 같은 requestId → DB가 이전 결과를 재생
  await page.getByRole('button', { name: '맛집 등록' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  const id = restaurantIdFromUrl(page);
  expect(await apiCountByName(api, name)).toBe(1);
  expect((await apiRestaurant(api, id))?.name).toBe(name);
});

/** 등록 화면에서 보낸 맛집 저장 Server Action POST 수를 센다(실제로 서버에 간 제출 시도). */
function countCreateActions(page: Page): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.headers()['next-action'] &&
      new URL(request.url()).pathname === '/restaurants/new'
    ) {
      count += 1;
    }
  });
  return () => count;
}

/*
 * 두 번 클릭 재현 방식(E2E v3 분석):
 * `Promise.all([click(), click({ force: true })])`은 force 클릭이 먼저 이기면 제품이 버튼을 (올바르게) 비활성화·잠그고,
 * 일반 click은 다시 활성화되기를 120초 기다리다 화면 이동으로 요소가 사라져 테스트 자체가 멈췄다.
 * 그래서 활성화를 기다리지 않는 결정적 방식으로 **실제 제출 시도 2번**을 만든다.
 */

test('화면: 저장 버튼을 같은 순간 두 번 눌러도 한 건만 생긴다(처리 중 동기 차단)', async ({ page }) => {
  await login(page, accounts.a);
  const api = await userClient(accounts.a);
  const name = uniqueName('두번클릭');
  const actions = countCreateActions(page);

  await page.goto('/restaurants/new');
  await fillRestaurantForm(page, { name });
  const button = page.getByRole('button', { name: '맛집 등록' });
  await expect(button).toBeEnabled();

  // 한 작업(task) 안에서 두 번 클릭한다. React가 비활성 상태를 다시 그리기 전이므로 두 번째 클릭도 제출 이벤트를 만든다.
  await button.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });

  await expect(page.getByRole('heading', { name })).toBeVisible();
  expect(actions(), '두 번째 클릭은 서버로 가지 않아야 한다').toBe(1);
  expect(await apiCountByName(api, name)).toBe(1);
});

test('화면: 저장 성공 뒤 화면 이동이 끝나기 전에 다시 제출해도 두 번째 맛집이 생기지 않는다', async ({ page }) => {
  await login(page, accounts.a);
  const api = await userClient(accounts.a);
  const name = uniqueName('이동전제출');
  const actions = countCreateActions(page);

  // 성공 뒤 상세 화면으로 가는 요청(RSC 또는 문서)을 붙잡아, "성공은 받았지만 아직 이동하지 않은" 구간을 만든다.
  // (E2E v2 결함: 이 구간에 버튼이 다시 활성화되고 요청 키가 버려져, 두 번째 클릭이 새 키로 두 번째 행을 만들었다.)
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let heldRequests = 0;
  await page.route(
    (url) => /^\/restaurants\/[0-9a-f-]{36}$/i.test(url.pathname),
    async (route) => {
      if (route.request().method() === 'GET') {
        heldRequests += 1;
        await held;
      }
      await route.continue();
    },
  );

  await page.goto('/restaurants/new');
  await fillRestaurantForm(page, { name });
  await page.getByRole('button', { name: '맛집 등록' }).click();

  // 성공 응답을 받아 잠긴 상태(이동 대기 중)
  await expect(page.getByRole('button', { name: '저장했어요. 이동 중…' })).toBeDisabled();
  await expect.poll(() => heldRequests, { message: '상세 화면 이동 요청을 붙잡지 못했다' }).toBeGreaterThan(0);
  expect(actions()).toBe(1);
  expect(await apiCountByName(api, name)).toBe(1);

  // 이 구간에 도착한 제출: requestSubmit은 비활성 버튼과 무관하게 제출 이벤트를 만든다
  // (결함이 있던 코드에서 이 구간의 클릭과 같은 경로다).
  const form = page.locator('form').filter({ has: page.getByLabel('메모') });
  await form.evaluate((element) => (element as HTMLFormElement).requestSubmit());
  // 두 번째 Server Action이 나가는지 잠시 지켜본다(나가면 곧바로 요청이 기록된다).
  await page.waitForTimeout(1_000);
  expect(actions(), '이동 대기 중 제출은 서버로 가지 않아야 한다').toBe(1);
  expect(await apiCountByName(api, name)).toBe(1);

  // 이동을 풀면 상세 화면으로 간다. 여전히 한 건이다.
  release();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  expect(actions()).toBe(1);
  expect(await apiCountByName(api, name)).toBe(1);
});

test('화면: 한 탭에서 방문 처리한 뒤 같은 사용자의 다른 탭에서 후기를 저장할 수 있다', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, accounts.b);
    const api = await userClient(accounts.b);
    const id = await apiCreateRestaurant(api, { name: uniqueName('재조회') });

    await gotoDetail(page, id);
    await page.getByRole('button', { name: '다녀왔어요' }).click();
    await expect(page.getByText(/다녀온 곳으로 저장했어요/)).toBeVisible();

    const other = await context.newPage();
    await gotoDetail(other, id);
    await other.getByRole('radio', { name: /3점/ }).check({ force: true });
    await other.getByRole('button', { name: '내 후기 저장' }).click();
    await expect(other.getByText('내 후기를 저장했어요.')).toBeVisible();
  } finally {
    await context.close();
  }
});
