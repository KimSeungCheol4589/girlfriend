import { expect, test } from '@playwright/test';

import {
  anonClient,
  apiCreateWish,
  apiWish,
  callRpc,
  loadWishAccounts,
  login,
  newRequestId,
  uniqueTitle,
  userClient,
  waitForScreen,
} from './helpers';

/**
 * 권한: 비로그인·외부 공간 계정은 위시의 **존재 여부도** 알 수 없다.
 *
 * 화면 버튼을 숨기는 것으로 검증을 대신하지 않는다(DESIGN 12).
 * 앱을 거치지 않는 직접 API 호출과 테이블 직접 쓰기까지 확인한다.
 */

const accounts = loadWishAccounts();

test.describe.configure({ mode: 'serial' });

let wishId = '';
let wishTitle = '';

test.beforeAll(async () => {
  const api = await userClient(accounts.a);
  wishTitle = uniqueTitle('권한 확인');
  wishId = await apiCreateWish(api, { title: wishTitle, category: 'place', memo: '비밀 메모' });
});

test('비로그인은 위시 화면에 들어갈 수 없다', async ({ page }) => {
  await page.goto('/wishes');
  await waitForScreen(page, ['login']);

  await page.goto(`/wishes/${wishId}`);
  await waitForScreen(page, ['login']);

  await page.goto('/wishes/new');
  await waitForScreen(page, ['login']);
});

test('비로그인 직접 API는 조회도 변경도 막힌다', async () => {
  const anon = anonClient();

  const { data, error } = await anon.from('wish_items').select('id, title').eq('id', wishId);
  // 권한 거부(42501) 또는 RLS로 0행. 어느 쪽이든 내용은 보이지 않는다.
  if (!error) expect(data ?? []).toHaveLength(0);

  const saved = await callRpc(anon, 'save_wish', {
    p_wish_id: null,
    p_title: '비로그인 저장',
    p_category: 'other',
    p_memo: '',
    p_link_url: null,
    p_expected_version: 0,
    p_request_id: newRequestId(),
  });
  expect(saved.ok).toBe(false);

  const status = await callRpc(anon, 'set_wish_status', {
    p_wish_id: wishId,
    p_status: 'done',
    p_planned_date: null,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(status.ok).toBe(false);

  const deleted = await callRpc(anon, 'delete_wish', {
    p_wish_id: wishId,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(deleted.ok).toBe(false);

  // 실제로 아무것도 바뀌지 않았다.
  const api = await userClient(accounts.a);
  expect((await apiWish(api, wishId))?.status).toBe('wish');
});

test('외부 공간 계정(C)은 화면에서도 내용을 볼 수 없다', async ({ page }) => {
  await login(page, accounts.c);

  await page.goto('/wishes');
  await expect(page.getByRole('heading', { name: '하고 싶은 일', exact: true })).toBeVisible();
  // 다른 공간의 위시는 목록에 없다.
  await expect(page.getByText(wishTitle)).toHaveCount(0);

  // 상세는 "없음"과 같은 화면이다(존재 여부를 알리지 않는다).
  await page.goto(`/wishes/${wishId}`);
  await expect(page.getByRole('heading', { name: '이 위시를 찾지 못했어요' })).toBeVisible();

  await page.goto(`/wishes/${wishId}/edit`);
  await expect(page.getByRole('heading', { name: '이 위시를 찾지 못했어요' })).toBeVisible();
});

test('외부 공간 계정(C)의 직접 API는 NOT_FOUND이고 아무것도 바꾸지 않는다', async () => {
  const api = await userClient(accounts.c);

  const rows = await api.from('wish_items').select('id').eq('id', wishId);
  expect(rows.data ?? []).toHaveLength(0);

  const edited = await callRpc(api, 'save_wish', {
    p_wish_id: wishId,
    p_title: '가로채기',
    p_category: 'other',
    p_memo: '',
    p_link_url: null,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(edited.ok).toBe(false);
  if (!edited.ok) expect(edited.code).toBe('GF404');

  const status = await callRpc(api, 'set_wish_status', {
    p_wish_id: wishId,
    p_status: 'done',
    p_planned_date: null,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(status.ok).toBe(false);
  if (!status.ok) expect(status.code).toBe('GF404');

  const deleted = await callRpc(api, 'delete_wish', {
    p_wish_id: wishId,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(deleted.ok).toBe(false);
  if (!deleted.ok) expect(deleted.code).toBe('GF404');

  const owner = await userClient(accounts.a);
  const row = await apiWish(owner, wishId);
  expect(row?.title).toBe(wishTitle);
  expect(row?.version).toBe(1);
});

test('로그인 사용자도 테이블에 직접 쓸 수 없다(RPC만 허용)', async () => {
  const api = await userClient(accounts.a);

  const inserted = await api.from('wish_items').insert({ title: '직접 삽입' });
  expect(inserted.error).not.toBeNull();

  const updated = await api.from('wish_items').update({ title: '직접 수정' }).eq('id', wishId);
  expect(updated.error).not.toBeNull();

  const removed = await api.from('wish_items').delete().eq('id', wishId);
  expect(removed.error).not.toBeNull();

  expect((await apiWish(api, wishId))?.title).toBe(wishTitle);
});

test('DB가 링크·분류·상태를 다시 검증한다(화면 검증을 우회해도 막힌다)', async () => {
  const api = await userClient(accounts.a);

  for (const link of [
    'http://example.invalid/insecure',
    'javascript:alert(1)',
    'https://trusted.invalid@evil.invalid/a',
    'https://a',
  ]) {
    const result = await callRpc(api, 'save_wish', {
      p_wish_id: null,
      p_title: uniqueTitle('링크'),
      p_category: 'other',
      p_memo: '',
      p_link_url: link,
      p_expected_version: 0,
      p_request_id: newRequestId(),
    });
    expect(result.ok, `거부해야 하는 링크: ${link}`).toBe(false);
    if (!result.ok) expect(result.code).toBe('GF422');
  }

  const badCategory = await callRpc(api, 'save_wish', {
    p_wish_id: null,
    p_title: uniqueTitle('분류'),
    p_category: 'restaurant',
    p_memo: '',
    p_link_url: null,
    p_expected_version: 0,
    p_request_id: newRequestId(),
  });
  expect(badCategory.ok).toBe(false);
  if (!badCategory.ok) expect(badCategory.code).toBe('GF422');

  const badStatus = await callRpc(api, 'set_wish_status', {
    p_wish_id: wishId,
    p_status: 'archived',
    p_planned_date: null,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(badStatus.ok).toBe(false);
  if (!badStatus.ok) expect(badStatus.code).toBe('GF422');

  // 'wish'에는 계획일을 붙일 수 없다.
  const badDate = await callRpc(api, 'set_wish_status', {
    p_wish_id: wishId,
    p_status: 'wish',
    p_planned_date: '2099-01-01',
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(badDate.ok).toBe(false);
  if (!badDate.ok) expect(badDate.code).toBe('GF422');
});
