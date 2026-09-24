import { expect, test } from '@playwright/test';

import {
  apiCountByTitle,
  apiCreateEvent,
  apiEvent,
  apiSetStatus,
  callRpc,
  eventArgs,
  gotoDetail,
  loadCalendarAccounts,
  login,
  newRequestId,
  openAs,
  stableMonthDay,
  uniqueTitle,
  userClient,
} from './helpers';

/**
 * 충돌(expectedVersion)과 멱등성(requestId) — DESIGN 8.4, CONTRACTS.md 7-1.
 *
 *   - 낡은 버전으로 보낸 저장·상태 변경·삭제는 **아무것도 바꾸지 않는다.**
 *   - 같은 requestId·같은 입력 재전송은 한 번만 반영되고 같은 결과를 돌려준다.
 *   - 같은 requestId·다른 입력은 거부된다.
 *   - 화면에서도 충돌 시 입력이 살아 있고, 방금 한 내 저장을 상대 충돌로 오인하지 않는다.
 */

const accounts = loadCalendarAccounts();

test.describe.configure({ mode: 'serial' });

const DAY = stableMonthDay(18);

test('같은 requestId로 다시 보내도 일정은 한 건만 생긴다(순차)', async () => {
  const api = await userClient(accounts.a);
  const title = uniqueTitle('멱등 순차');
  const args = eventArgs({ title, startDate: DAY, startTime: '10:00' });
  const key = newRequestId();

  const first = await callRpc(api, 'save_calendar_event', { ...args, p_request_id: key });
  const second = await callRpc(api, 'save_calendar_event', { ...args, p_request_id: key });

  expect(first.ok && second.ok).toBe(true);
  if (first.ok && second.ok) expect(second.data.eventId).toBe(first.data.eventId);
  expect(await apiCountByTitle(api, title)).toBe(1);
});

test('같은 requestId로 동시에 보내도 한 건만 생긴다', async () => {
  const api = await userClient(accounts.a);
  const title = uniqueTitle('멱등 동시');
  const args = eventArgs({ title, startDate: DAY, startTime: '11:00' });
  const key = newRequestId();

  const [a, b] = await Promise.all([
    callRpc(api, 'save_calendar_event', { ...args, p_request_id: key }),
    callRpc(api, 'save_calendar_event', { ...args, p_request_id: key }),
  ]);

  // 한쪽은 성공하고, 다른 쪽은 성공(재생) 또는 처리 중(RETRYABLE)이다. 어느 쪽이든 행은 하나다.
  expect(a.ok || b.ok).toBe(true);
  expect(await apiCountByTitle(api, title)).toBe(1);
});

test('같은 requestId에 다른 입력은 CONFLICT다', async () => {
  const api = await userClient(accounts.a);
  const key = newRequestId();

  const first = await callRpc(api, 'save_calendar_event', {
    ...eventArgs({ title: uniqueTitle('키 재사용'), startDate: DAY, startTime: '12:00' }),
    p_request_id: key,
  });
  expect(first.ok).toBe(true);

  const second = await callRpc(api, 'save_calendar_event', {
    ...eventArgs({ title: uniqueTitle('다른 입력'), startDate: DAY, startTime: '12:00' }),
    p_request_id: key,
  });
  expect(second.ok).toBe(false);
  if (!second.ok) expect(second.code).toBe('GF409');
});

test('상태 변경 재전송은 버전을 두 번 올리지 않는다', async () => {
  const api = await userClient(accounts.a);
  const id = await apiCreateEvent(api, {
    title: uniqueTitle('상태 멱등'),
    startDate: DAY,
    startTime: '13:00',
  });
  const key = newRequestId();

  const first = await callRpc(api, 'set_calendar_event_status', {
    p_event_id: id,
    p_status: 'done',
    p_expected_version: 1,
    p_request_id: key,
  });
  const replay = await callRpc(api, 'set_calendar_event_status', {
    p_event_id: id,
    p_status: 'done',
    p_expected_version: 1,
    p_request_id: key,
  });

  expect(first.ok && replay.ok).toBe(true);
  expect((await apiEvent(api, id))?.version).toBe(2);
});

test('낡은 버전의 저장·상태 변경·삭제는 아무것도 바꾸지 않는다', async () => {
  const api = await userClient(accounts.a);
  const title = uniqueTitle('충돌 대상');
  const id = await apiCreateEvent(api, { title, startDate: DAY, startTime: '14:00' });

  // 상대(B)가 먼저 바꿔 버전을 올린다.
  const apiB = await userClient(accounts.b);
  await apiSetStatus(apiB, id, 'done', 1);

  const stale = await callRpc(api, 'save_calendar_event', {
    ...eventArgs(
      { title: '낡은 저장', startDate: DAY, startTime: '14:00' },
      { eventId: id, expectedVersion: 1 },
    ),
    p_request_id: newRequestId(),
  });
  expect(stale.ok).toBe(false);
  if (!stale.ok) expect(stale.code).toBe('GF409');

  const staleStatus = await callRpc(api, 'set_calendar_event_status', {
    p_event_id: id,
    p_status: 'cancelled',
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(staleStatus.ok).toBe(false);
  if (!staleStatus.ok) expect(staleStatus.code).toBe('GF409');

  const staleDelete = await callRpc(api, 'delete_calendar_event', {
    p_event_id: id,
    p_expected_version: 1,
    p_request_id: newRequestId(),
  });
  expect(staleDelete.ok).toBe(false);
  if (!staleDelete.ok) expect(staleDelete.code).toBe('GF409');

  const row = await apiEvent(api, id);
  expect(row?.title).toBe(title);
  expect(row?.status).toBe('done');
  expect(row?.version).toBe(2);
});

test('화면: 충돌이 나면 입력한 내용이 남고 최신 내용을 불러올 수 있다', async ({ browser }) => {
  const api = await userClient(accounts.a);
  const title = uniqueTitle('화면 충돌');
  const id = await apiCreateEvent(api, { title, startDate: DAY, startTime: '15:00' });

  const { context, page } = await openAs(browser, accounts.a);
  await page.goto(`/calendar/${id}/edit`);
  await expect(page.getByRole('heading', { name: '일정 수정' })).toBeVisible();

  // 이 화면을 연 뒤 상대가 상태를 바꾼다.
  const apiB = await userClient(accounts.b);
  await apiSetStatus(apiB, id, 'cancelled', 1);

  const myText = `${title} (내가 고친 제목)`;
  await page.getByLabel('제목').fill(myText);
  await page.getByRole('button', { name: '변경 저장' }).click();

  await expect(page.getByText(/상대방이 먼저 바꾼 내용이 있어/)).toBeVisible();
  // 입력한 내용은 지워지지 않는다.
  await expect(page.getByLabel('제목')).toHaveValue(myText);
  // 저장은 되지 않았다.
  expect((await apiEvent(api, id))?.title).toBe(title);

  await page.getByRole('button', { name: /최신 내용 불러오기/ }).click();
  await expect(page.getByText('최신 내용을 불러왔어요. 다시 고친 뒤 저장해 주세요.')).toBeVisible();
  await expect(page.getByLabel('제목')).toHaveValue(title);

  await context.close();
});

test('화면: 삭제 확인 뒤 상대가 바꿨으면 지우지 않는다', async ({ browser }) => {
  const api = await userClient(accounts.a);
  const title = uniqueTitle('삭제 충돌');
  const id = await apiCreateEvent(api, { title, startDate: DAY, startTime: '16:00' });

  const { context, page } = await openAs(browser, accounts.a);
  await gotoDetail(page, id);
  await page.getByRole('button', { name: '일정 삭제' }).click();

  // 확인 창을 본 뒤 상대가 상태를 바꾼다.
  const apiB = await userClient(accounts.b);
  await apiSetStatus(apiB, id, 'done', 1);

  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByText(/확인한 뒤에 일정이 바뀌어 아무것도 바꾸지 않았어요/)).toBeVisible();
  expect(await apiEvent(api, id)).not.toBeNull();

  await context.close();
});

test('화면: 저장 직후 곧바로 상태를 또 바꿔도 자기 변경을 충돌로 오인하지 않는다', async ({
  browser,
}) => {
  const api = await userClient(accounts.a);
  const id = await apiCreateEvent(api, {
    title: uniqueTitle('연속 전환'),
    startDate: DAY,
    startTime: '17:00',
  });

  const { context, page } = await openAs(browser, accounts.a);
  await gotoDetail(page, id);

  // 첫 전환의 **성공 안내만** 기다린다(서버 상세 재렌더는 기다리지 않는다).
  // 그 상태에서 곧바로 두 번째 전환을 누르면 낡은 version을 보내기 쉬운 타이밍이 된다.
  await page.getByRole('button', { name: '완료로 바꾸기' }).click();
  await expect(page.getByText('완료로 표시했어요.')).toBeVisible();

  await page.getByRole('button', { name: '취소로 바꾸기' }).click();
  // 두 번째 전환도 성공해야 한다. 순서를 이렇게 두어 "요청이 끝나기 전 부재 확인"으로 통과하지 않게 한다.
  await expect(page.getByText('취소한 일정으로 표시했어요. 일정은 지워지지 않아요.')).toBeVisible();
  await expect(page.getByText(/상대방이 먼저 바꾼 내용이 있어/)).toHaveCount(0);

  const row = await apiEvent(api, id);
  expect(row?.status).toBe('cancelled');
  expect(row?.version).toBe(3);

  await context.close();
});

test('화면: 처리 중 두 번 눌러도 두 번째 일정이 생기지 않는다', async ({ page }) => {
  await login(page, accounts.a);
  const title = uniqueTitle('중복 클릭');

  await page.goto('/calendar/new');
  await expect(page.getByRole('heading', { name: '일정 추가' })).toBeVisible();
  await page.getByLabel('제목').fill(title);
  await page.getByLabel('시작 날짜').fill(DAY);
  await page.getByLabel('시작 시각').fill('18:00');

  const submit = page.getByRole('button', { name: '일정 등록' });
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
