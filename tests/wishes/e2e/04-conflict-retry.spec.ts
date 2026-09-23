import { expect, test } from '@playwright/test';

import {
  apiCountByTitle,
  apiCreateWish,
  apiSetStatus,
  apiWish,
  callRpc,
  createWishViaUi,
  gotoDetail,
  gotoWishes,
  loadWishAccounts,
  login,
  logout,
  newRequestId,
  openAs,
  seoulDateInDays,
  uniqueTitle,
  userClient,
} from './helpers';

/**
 * 버전 충돌·중복 제출·응답 유실 재시도·재로그인 지속성.
 *
 * - 같은 requestId·같은 입력 재전송은 한 번만 반영된다(동시 전송 포함).
 * - 같은 requestId·다른 입력은 거부된다.
 * - 오래된 버전의 저장은 조용히 덮어쓰지 않고, 화면은 입력을 유지한 채 알린다.
 * - 처리 중 두 번 누르기는 두 번째 요청을 만들지 않는다.
 * - 로그아웃 후 다시 로그인해도 저장한 내용이 그대로 있다.
 */

const accounts = loadWishAccounts();

test.describe.configure({ mode: 'serial' });

test('API: 같은 requestId 재전송(순차·동시)은 한 건만 만들고 같은 ID를 돌려준다', async () => {
  const api = await userClient(accounts.a);
  const title = uniqueTitle('중복 생성');
  const requestId = newRequestId();
  const args = {
    p_wish_id: null,
    p_title: title,
    p_category: 'other',
    p_memo: '',
    p_link_url: null,
    p_expected_version: 0,
    p_request_id: requestId,
  };

  const [first, second] = await Promise.all([
    callRpc(api, 'save_wish', args),
    callRpc(api, 'save_wish', args),
  ]);
  const third = await callRpc(api, 'save_wish', args);

  expect(first.ok && second.ok && third.ok).toBe(true);
  if (first.ok && second.ok && third.ok) {
    expect(second.data.wishId).toBe(first.data.wishId);
    expect(third.data.wishId).toBe(first.data.wishId);
  }
  expect(await apiCountByTitle(api, title)).toBe(1);

  // 같은 키에 다른 입력은 거부된다.
  const mismatch = await callRpc(api, 'save_wish', { ...args, p_title: `${title} 다른 입력` });
  expect(mismatch.ok).toBe(false);
  if (!mismatch.ok) expect(mismatch.code).toBe('GF409');
  expect(await apiCountByTitle(api, `${title} 다른 입력`)).toBe(0);
});

test('API: 상태 전환 재전송은 버전을 두 번 올리지 않는다', async () => {
  const api = await userClient(accounts.a);
  const id = await apiCreateWish(api, { title: uniqueTitle('상태 재전송') });
  const requestId = newRequestId();
  const args = {
    p_wish_id: id,
    p_status: 'planned',
    p_planned_date: seoulDateInDays(10),
    p_expected_version: 1,
    p_request_id: requestId,
  };

  const first = await callRpc(api, 'set_wish_status', args);
  const replay = await callRpc(api, 'set_wish_status', args);
  expect(first.ok && replay.ok).toBe(true);
  if (first.ok && replay.ok) expect(replay.data.version).toBe(first.data.version);

  // 저장된 버전도 한 번만 올라갔다.
  expect((await apiWish(api, id))?.version).toBe(2);
});

test('API: 오래된 버전의 저장·전환·삭제는 아무것도 바꾸지 않는다', async () => {
  const api = await userClient(accounts.a);
  const title = uniqueTitle('버전 충돌');
  const id = await apiCreateWish(api, { title });
  await apiSetStatus(api, id, 'planned', null, 1); // version 2

  const staleSave = await callRpc(api, 'save_wish', {
    p_wish_id: id,
    p_title: '덮어쓰기',
    p_category: 'other',
    p_memo: '',
    p_link_url: null,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(staleSave.ok).toBe(false);
  if (!staleSave.ok) expect(staleSave.code).toBe('GF409');

  const staleStatus = await callRpc(api, 'set_wish_status', {
    p_wish_id: id,
    p_status: 'done',
    p_planned_date: null,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(staleStatus.ok).toBe(false);

  const staleDelete = await callRpc(api, 'delete_wish', {
    p_wish_id: id,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(staleDelete.ok).toBe(false);

  const row = await apiWish(api, id);
  expect(row?.title).toBe(title);
  expect(row?.status).toBe('planned');
  expect(row?.version).toBe(2);
});

test('화면: 상대가 먼저 고치면 덮어쓰지 않고 입력을 유지한 채 알린다', async ({ browser }) => {
  const a = await openAs(browser, accounts.a);
  const b = await openAs(browser, accounts.b);

  try {
    const title = uniqueTitle('동시 편집');
    const id = await createWishViaUi(a.page, { title, memo: '처음 메모' });

    // A가 수정 화면을 연다.
    await a.page.goto(`/wishes/${id}/edit`);
    await expect(a.page.getByRole('heading', { name: '위시 수정' })).toBeVisible();

    // 그 사이 B가 먼저 저장한다.
    await b.page.goto(`/wishes/${id}/edit`);
    await b.page.getByLabel('메모').fill('B가 먼저 저장');
    await b.page.getByRole('button', { name: '변경 저장' }).click();
    await expect(b.page.getByText('B가 먼저 저장')).toBeVisible();

    // A가 저장하면 충돌로 거부되고, A가 쓴 내용은 화면에 남는다.
    await a.page.getByLabel('메모').fill('A가 쓰던 메모');
    await a.page.getByRole('button', { name: '변경 저장' }).click();
    await expect(a.page.getByText(/상대방이 먼저 바꾼 내용/)).toBeVisible();
    await expect(a.page.getByLabel('메모')).toHaveValue('A가 쓰던 메모');

    // 덮어쓰지 않았다.
    const api = await userClient(accounts.a);
    expect((await apiWish(api, id))?.memo).toBe('B가 먼저 저장');

    // "최신 내용 불러오기"를 누르면 서버 값으로 바뀐다.
    await a.page.getByRole('button', { name: /최신 내용 불러오기/ }).click();
    await expect(a.page.getByText(/최신 내용을 불러왔어요/)).toBeVisible();
    await expect(a.page.getByLabel('메모')).toHaveValue('B가 먼저 저장');

    // 이제 저장하면 성공한다.
    await a.page.getByLabel('메모').fill('A가 다시 저장');
    await a.page.getByRole('button', { name: '변경 저장' }).click();
    await expect(a.page.getByText('A가 다시 저장')).toBeVisible();
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('화면: 저장 직후 곧바로 다시 상태를 바꿔도 자기 변경을 충돌로 오인하지 않는다', async ({ page }) => {
  await login(page, accounts.a);
  const title = uniqueTitle('연속 전환');
  const id = await createWishViaUi(page, { title, category: 'place' });
  const api = await userClient(accounts.a);

  /**
   * 재현하려는 타이밍(독립 검토 P2)
   *
   * 저장에 성공하면 성공 안내는 **서버 응답 직후** 뜨지만, 서버가 다시 그린 결과(version prop)는
   * 그보다 늦게 도착한다. 그 사이에 다음 전환을 누르면 낡은 version을 expectedVersion으로 보내게 되어,
   * **자기 변경**을 상대방이 먼저 바꾼 충돌로 오인했다.
   *
   * 그래서 "서버 상세가 다시 그려지기를 기다리지 않고" 곧바로 두 번째 전환을 누른다.
   */
  await page.getByRole('button', { name: '계획했어요로 바꾸기' }).click();
  await expect(page.getByRole('status')).toContainText('계획했어요로 저장했어요');

  await page.getByRole('button', { name: '해냈어요로 바꾸기' }).click();

  // 두 번째 전환도 성공해야 한다. 먼저 성공을 확인해야 아래 "충돌 없음"이 의미 있는 단언이 된다
  // (클릭 직후 곧바로 부재를 보면 요청이 끝나기 전이라 언제나 통과한다).
  await expect(page.getByRole('status')).toContainText('해낸 일로 저장했어요');
  // 상대방은 아무것도 바꾸지 않았으므로 충돌 안내가 뜨면 안 된다.
  await expect(page.getByText(/상대방이 먼저 바꾼 내용/)).toHaveCount(0);

  // 두 번의 저장이 모두 반영돼야 한다(생성 1 → 계획 2 → 완료 3).
  await expect
    .poll(async () => {
      const row = await apiWish(api, id);
      return { status: row?.status, version: row?.version };
    })
    .toEqual({ status: 'done', version: 3 });
});

test('화면: 삭제 확인 뒤 상대가 바꾸면 아무것도 지우지 않는다', async ({ browser }) => {
  const a = await openAs(browser, accounts.a);
  const b = await openAs(browser, accounts.b);

  try {
    const title = uniqueTitle('삭제 경쟁');
    const id = await createWishViaUi(a.page, { title });

    // A가 삭제 확인 창을 연다(이 시점의 버전이 기준이다).
    await gotoDetail(a.page, id);
    await a.page.getByRole('button', { name: '위시 삭제' }).click();

    // 그 사이 B가 상태를 바꾼다.
    const apiB = await userClient(accounts.b);
    await apiSetStatus(apiB, id, 'planned', seoulDateInDays(5), 1);

    // A가 확인해도 지워지지 않는다.
    await a.page.getByRole('button', { name: '삭제', exact: true }).click();
    await expect(a.page.getByText(/확인한 뒤에 위시가 바뀌어/)).toBeVisible();

    const api = await userClient(accounts.a);
    const row = await apiWish(api, id);
    expect(row).not.toBeNull();
    expect(row?.status).toBe('planned');
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('화면: 처리 중 두 번 누르기는 두 번째 위시를 만들지 않는다', async ({ page }) => {
  await login(page, accounts.a);
  const title = uniqueTitle('중복 제출');

  await page.goto('/wishes/new');
  await expect(page.getByRole('heading', { name: '위시 추가' })).toBeVisible();
  await page.getByLabel('제목').fill(title);

  const submit = page.getByRole('button', { name: '위시 등록' });
  // 버튼이 눌릴 수 있는 상태가 될 때까지(하이드레이션 완료) 기다린다.
  await expect(submit).toBeEnabled();

  // 같은 태스크에서 두 번 누른다. React가 버튼을 비활성화하기 전에 두 번째 제출이 들어오므로,
  // 훅의 **동기** 관문(beginMutation)이 두 번째를 버리는지 확인할 수 있다.
  // 찾아 둔 요소에 직접 건다(머리말의 로그아웃 폼에도 submit 버튼이 있어 문서 전체 선택자는 쓰지 않는다).
  await submit.evaluate((element) => {
    const button = element as HTMLButtonElement;
    button.click();
    button.click();
  });

  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  const api = await userClient(accounts.a);
  expect(await apiCountByTitle(api, title)).toBe(1);
});

test('재로그인해도 저장한 위시가 그대로 있다', async ({ page }) => {
  await login(page, accounts.a);

  const title = uniqueTitle('지속성');
  const future = seoulDateInDays(14);
  const id = await createWishViaUi(page, {
    title,
    category: 'trip',
    linkUrl: 'https://example.invalid/trip',
    memo: '재로그인 뒤에도 남아야 한다',
  });

  await page.getByLabel('계획한 날짜').fill(future);
  await page.getByRole('button', { name: '계획했어요로 바꾸기' }).click();
  await expect(page.getByRole('status')).toContainText('하기로 저장했어요');

  await logout(page);
  await login(page, accounts.a);

  await gotoDetail(page, id);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('재로그인 뒤에도 남아야 한다')).toBeVisible();
  await expect(page.getByLabel('계획한 날짜')).toHaveValue(future);
  await expect(page.getByRole('link', { name: /링크 열기/ })).toBeVisible();

  // 상대 계정으로 다시 로그인해도 같은 내용을 본다.
  await logout(page);
  await login(page, accounts.b);
  await gotoWishes(page);
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
});
