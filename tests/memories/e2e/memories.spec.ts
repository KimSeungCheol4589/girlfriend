import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { login, logout, waitForScreen } from '../../auth/e2e/helpers';
import { rpc, select } from '../support/local-api';

import {
  NOT_FOUND_HEADING,
  countByTitle,
  createMemoryViaApi,
  isServerActionRequest,
  openSession,
  requireEnv,
  runMarker,
  tokenFor,
  tomorrowInSeoul,
  waitForMemoryDetail,
} from './helpers';

/**
 * 실제 추억 글 기능(로컬 Supabase, 합성 계정 A·B 같은 공간, C 외부 공간).
 * 모든 검증은 실제 서버·DB를 거친다. 화면 버튼을 숨기는 것만으로 권한을 검증하지 않는다.
 */

test.describe.configure({ mode: 'serial' });

const { env, accounts } = requireEnv();
const RUN = runMarker();

test('A가 만든 기록을 B가 보고 고칠 수 있고, 다시 로그인해도 남아 있다', async ({ browser }) => {
  const a = await openSession(browser, accounts.a);
  const title = `한강 산책 ${RUN}`;

  await a.page.goto('/memories/new');
  await expect(a.page.getByRole('heading', { name: '새 추억' })).toBeVisible();
  await a.page.getByLabel('제목').fill(title);
  await a.page.getByLabel('장소').fill('여의도');
  await a.page.getByLabel('태그').fill(`산책, t${RUN}`);
  await a.page.getByLabel('내용').fill('노을이 예뻤다.\n<b>태그는 글자로만</b>');
  await a.page.getByRole('button', { name: '기록 저장' }).click();

  const memoryId = await waitForMemoryDetail(a.page, title);
  await expect(a.page.getByRole('status').filter({ hasText: '저장했어요' })).toBeVisible();
  // 본문은 HTML로 해석하지 않는다.
  await expect(a.page.getByText('<b>태그는 글자로만</b>')).toBeVisible();

  // B: 같은 공간에서 목록·상세 확인 후 수정
  const b = await openSession(browser, accounts.b);
  await b.page.goto('/memories');
  await expect(b.page.getByRole('heading', { name: title })).toBeVisible();
  await b.page.goto(`/memories/${memoryId}`);
  await expect(b.page.getByText('mem-a 기록')).toBeVisible();
  await b.page.getByRole('link', { name: '수정' }).click();
  await expect(b.page.getByRole('heading', { name: '기록 수정' })).toBeVisible();
  const edited = `${title} (B 수정)`;
  await b.page.getByLabel('제목').fill(edited);
  await b.page.getByRole('button', { name: '수정 내용 저장' }).click();
  await waitForMemoryDetail(b.page, edited);

  // A: 새로 불러오면 B의 수정이 보이고, 로그아웃 후 다시 로그인해도 남아 있다.
  await a.page.reload();
  await expect(a.page.getByRole('heading', { level: 1, name: edited })).toBeVisible();
  await logout(a.page);
  await login(a.page, accounts.a);
  await a.page.goto(`/memories/${memoryId}`);
  await expect(a.page.getByRole('heading', { level: 1, name: edited })).toBeVisible();

  await a.context.close();
  await b.context.close();
});

test('월·태그 필터는 URL에 남고 조건에 맞는 기록만 보여 준다', async ({ browser }) => {
  const token = await tokenFor(env, accounts.a);
  const tagX = `x${RUN}`;
  const tagY = `y${RUN}`;
  await createMemoryViaApi(env, token, { title: `필터 X ${RUN}`, memoryDate: '2025-03-10', tags: [tagX] });
  await createMemoryViaApi(env, token, { title: `필터 Y ${RUN}`, memoryDate: '2025-04-10', tags: [tagY, '쉼표,있는 태그'] });

  const a = await openSession(browser, accounts.a);
  await a.page.goto(`/memories?tag=${encodeURIComponent(tagX)}`);
  await expect(a.page.getByRole('heading', { name: `필터 X ${RUN}` })).toBeVisible();
  await expect(a.page.getByRole('heading', { name: `필터 Y ${RUN}` })).toHaveCount(0);

  await a.page.goto(`/memories?month=2025-04&tag=${encodeURIComponent(tagY)}`);
  await expect(a.page.getByRole('heading', { name: `필터 Y ${RUN}` })).toBeVisible();

  // 쉼표가 든 태그도 정확히 찾는다(배열 리터럴 이스케이프).
  await a.page.goto(`/memories?tag=${encodeURIComponent('쉼표,있는 태그')}`);
  await expect(a.page.getByRole('heading', { name: `필터 Y ${RUN}` })).toBeVisible();

  await a.page.goto(`/memories?month=2025-03&tag=${encodeURIComponent(tagY)}`);
  await expect(a.page.getByText('이 조건에 맞는 기록이 없어요')).toBeVisible();

  await a.context.close();
});

test('20개씩 더 보기: 최신 날짜·ID 내림차순, 중복·누락 없음, 필터가 바뀌면 처음부터', async ({ browser }) => {
  const token = await tokenFor(env, accounts.a);
  const tag = `p${RUN}`;
  // 같은 날짜가 섞이도록 22개를 만든다(날짜가 같으면 id로 정렬).
  for (let index = 0; index < 22; index += 1) {
    const day = String(1 + (index % 7)).padStart(2, '0');
    await createMemoryViaApi(env, token, { title: `페이지 ${RUN} ${index}`, memoryDate: `2024-05-${day}`, tags: [tag] });
  }

  const expected = await select<{ id: string }[]>(
    env,
    token,
    'memories',
    `select=id&tags=cs.${encodeURIComponent(`{"${tag}"}`)}&order=memory_date.desc,id.desc`,
  );
  const expectedIds = (expected.data ?? []).map((row) => row.id);
  expect(expectedIds).toHaveLength(22);

  const a = await openSession(browser, accounts.a);
  await a.page.goto(`/memories?tag=${encodeURIComponent(tag)}`);
  const cards = a.page.getByRole('list', { name: '추억 목록' }).getByRole('link');
  await expect(cards).toHaveCount(20);

  await a.page.getByRole('button', { name: '더 보기' }).click();
  await expect(cards).toHaveCount(22);
  await expect(a.page.getByRole('button', { name: '더 보기' })).toHaveCount(0);

  const hrefs = await cards.evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  const shownIds = hrefs.map((href) => href.replace('/memories/', ''));
  expect(shownIds).toEqual(expectedIds);

  // 필터를 바꾸면(월 추가) 커서가 초기화되고 그 조건의 첫 페이지부터 보인다.
  await a.page.goto(`/memories?month=2024-05&tag=${encodeURIComponent(tag)}`);
  await expect(cards).toHaveCount(20);

  await a.context.close();
});

test('상대가 먼저 저장하면 충돌을 알리고 쓰던 내용을 그대로 둔다', async ({ browser }) => {
  const tokenA = await tokenFor(env, accounts.a);
  const tokenB = await tokenFor(env, accounts.b);
  const title = `충돌 ${RUN}`;
  const memoryId = await createMemoryViaApi(env, tokenA, { title, memoryDate: '2026-01-05' });

  const a = await openSession(browser, accounts.a);
  await a.page.goto(`/memories/${memoryId}/edit`);
  await expect(a.page.getByRole('heading', { name: '기록 수정' })).toBeVisible();
  const mine = `${title} A가 쓰던 제목`;
  await a.page.getByLabel('제목').fill(mine);
  await a.page.getByLabel('내용').fill('A가 쓰던 본문');

  // B가 먼저 저장(버전 1 → 2)
  const peer = await rpc(env, tokenB, 'save_memory', {
    p_memory_id: memoryId,
    p_title: `${title} B가 먼저`,
    p_body: '',
    p_memory_date: '2026-01-05',
    p_location: null,
    p_tags: [],
    p_photo_asset_ids: [],
    p_is_pinned: false,
    p_expected_version: 1,
    p_request_id: randomUUID(),
  });
  expect(peer.status).toBe(200);

  await a.page.getByRole('button', { name: '수정 내용 저장' }).click();
  await expect(a.page.getByText('상대방이 먼저 저장했어요')).toBeVisible();
  await expect(a.page.getByLabel('제목')).toHaveValue(mine);
  await expect(a.page.getByLabel('내용')).toHaveValue('A가 쓰던 본문');

  const stored = await select<{ title: string; version: number }[]>(env, tokenA, 'memories', `select=title,version&id=eq.${memoryId}`);
  expect(stored.data?.[0]).toEqual({ title: `${title} B가 먼저`, version: 2 });

  await a.context.close();
});

test('같은 requestId 재전송은 한 번만 반영되고, 같은 키에 다른 입력은 거부된다', async () => {
  const token = await tokenFor(env, accounts.a);
  const title = `멱등 ${RUN}`;
  const requestId = randomUUID();
  const args = {
    p_memory_id: null,
    p_title: title,
    p_body: '',
    p_memory_date: '2026-02-01',
    p_location: null,
    p_tags: [],
    p_photo_asset_ids: [],
    p_is_pinned: false,
    p_expected_version: 0,
    p_request_id: requestId,
  };

  const first = await rpc<{ memoryId: string }>(env, token, 'save_memory', args);
  const second = await rpc<{ memoryId: string }>(env, token, 'save_memory', args);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(first.data?.memoryId === second.data?.memoryId).toBe(true);
  expect(await countByTitle(env, token, title)).toBe(1);

  const changed = await rpc(env, token, 'save_memory', { ...args, p_title: `${title} 바뀜` });
  expect(changed.code).toBe('GF409');
  expect(await countByTitle(env, token, `${title} 바뀜`)).toBe(0);
});

test('응답을 잃은 저장을 다시 시도해도 기록은 하나만 생기고 입력은 유지된다', async ({ browser }) => {
  const token = await tokenFor(env, accounts.a);
  const title = `응답 유실 ${RUN}`;
  const a = await openSession(browser, accounts.a);
  await a.page.goto('/memories/new');
  await a.page.getByLabel('제목').fill(title);
  await a.page.getByLabel('내용').fill('유지되어야 하는 본문');

  // 첫 저장 요청은 서버까지 실제로 보내고(처리됨) 브라우저에는 응답을 주지 않는다.
  let dropped = false;
  await a.page.route('**/memories/new', async (route) => {
    const request = route.request();
    if (!dropped && isServerActionRequest(request.method(), await request.allHeaders())) {
      dropped = true;
      await route.fetch().catch(() => undefined);
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });

  await a.page.getByRole('button', { name: '기록 저장' }).click();
  await expect(a.page.getByText('저장하지 못했어요. 다시 시도해 주세요')).toBeVisible();
  await expect(a.page.getByLabel('제목')).toHaveValue(title);
  await expect(a.page.getByLabel('내용')).toHaveValue('유지되어야 하는 본문');
  expect(await countByTitle(env, token, title)).toBe(1);

  await a.page.unroute('**/memories/new');
  await a.page.getByRole('button', { name: '기록 저장' }).click();
  await waitForMemoryDetail(a.page, title);
  // 같은 requestId로 재생됐으므로 여전히 하나다.
  expect(await countByTitle(env, token, title)).toBe(1);

  await a.context.close();
});

test('저장 버튼을 빠르게 두 번 눌러도 기록은 하나만 생긴다', async ({ browser }) => {
  const token = await tokenFor(env, accounts.a);
  const title = `두 번 클릭 ${RUN}`;
  const a = await openSession(browser, accounts.a);
  await a.page.goto('/memories/new');
  await a.page.getByLabel('제목').fill(title);
  await a.page.getByRole('button', { name: '기록 저장' }).dblclick();
  await waitForMemoryDetail(a.page, title);
  expect(await countByTitle(env, token, title)).toBe(1);
  await a.context.close();
});

test('입력 오류는 필드와 요약에 보이고, 쓰던 내용은 그대로 남는다', async ({ browser }) => {
  const a = await openSession(browser, accounts.a);
  await a.page.goto('/memories/new');
  await a.page.getByLabel('내용').fill('제목 없이 쓴 본문');
  await a.page.getByRole('button', { name: '기록 저장' }).click();
  await expect(a.page.getByText('제목을 입력해 주세요.').first()).toBeVisible();
  await expect(a.page.getByLabel('제목')).toBeFocused();
  await expect(a.page.getByLabel('내용')).toHaveValue('제목 없이 쓴 본문');

  // 미래 날짜는 서버(Zod·DB)가 거부한다.
  await a.page.getByLabel('제목').fill(`미래 ${RUN}`);
  await a.page.getByLabel('날짜').fill(tomorrowInSeoul());
  await a.page.getByRole('button', { name: '기록 저장' }).click();
  await expect(a.page.getByText('오늘(한국 날짜)보다 뒤의 날짜는 저장할 수 없어요.').first()).toBeVisible();
  await expect(a.page.getByLabel('제목')).toHaveValue(`미래 ${RUN}`);
  expect(await countByTitle(env, await tokenFor(env, accounts.a), `미래 ${RUN}`)).toBe(0);

  await a.context.close();
});

test('형식이 틀린 ID·없는 ID·다른 공간의 ID는 모두 같은 404다', async ({ browser }) => {
  const tokenC = await tokenFor(env, accounts.c);
  const externalId = await createMemoryViaApi(env, tokenC, { title: `외부 기록 ${RUN}`, memoryDate: '2026-03-01' });

  const a = await openSession(browser, accounts.a);
  const texts: string[] = [];
  for (const path of [
    '/memories/not-a-uuid',
    `/memories/${randomUUID()}`,
    `/memories/${externalId}`,
    `/memories/${externalId}/edit`,
  ]) {
    await a.page.goto(path);
    await expect(a.page.getByRole('heading', { name: NOT_FOUND_HEADING })).toBeVisible();
    await expect(a.page.getByText(`외부 기록 ${RUN}`)).toHaveCount(0);
    // 404 경계는 본문 랜드마크를 하나만 그린다. 네 경우의 본문 전체가 글자 하나까지 같아야 한다.
    const main = a.page.getByRole('main');
    await expect(main).toHaveCount(1);
    texts.push((await main.innerText()).trim());
  }
  expect(new Set(texts).size).toBe(1);
  await a.context.close();
});

test('RLS: 비로그인·외부 계정은 기록을 읽거나 바꾸지 못하고, 사용자는 확정 RPC를 부를 수 없다', async () => {
  const tokenA = await tokenFor(env, accounts.a);
  const tokenC = await tokenFor(env, accounts.c);
  const memoryId = await createMemoryViaApi(env, tokenA, { title: `권한 ${RUN}`, memoryDate: '2026-03-02' });

  // 비로그인: 테이블 권한 없음
  const anonRead = await select(env, null, 'memories', `select=id&id=eq.${memoryId}`);
  expect(anonRead.status === 200 ? (anonRead.data as unknown[]).length : 0).toBe(0);
  const anonWrite = await rpc(env, null, 'save_memory', {
    p_memory_id: memoryId,
    p_title: '비로그인',
    p_body: '',
    p_memory_date: '2026-03-02',
    p_location: null,
    p_tags: [],
    p_photo_asset_ids: [],
    p_is_pinned: false,
    p_expected_version: 1,
    p_request_id: randomUUID(),
  });
  expect(anonWrite.status >= 400).toBe(true);

  // 외부 계정 C: 보이지 않고, 수정·삭제는 존재를 알리지 않는 NOT_FOUND
  const externalRead = await select<unknown[]>(env, tokenC, 'memories', `select=id&id=eq.${memoryId}`);
  expect(externalRead.data).toEqual([]);
  const externalPhotos = await select<unknown[]>(env, tokenC, 'memory_photos', `select=id&memory_id=eq.${memoryId}`);
  expect(externalPhotos.data).toEqual([]);
  const externalSave = await rpc(env, tokenC, 'save_memory', {
    p_memory_id: memoryId,
    p_title: '외부 수정',
    p_body: '',
    p_memory_date: '2026-03-02',
    p_location: null,
    p_tags: [],
    p_photo_asset_ids: [],
    p_is_pinned: false,
    p_expected_version: 1,
    p_request_id: randomUUID(),
  });
  expect(externalSave.code).toBe('GF404');
  const externalDelete = await rpc(env, tokenC, 'delete_memory', {
    p_memory_id: memoryId,
    p_expected_version: 1,
    p_request_id: randomUUID(),
  });
  expect(externalDelete.code).toBe('GF404');

  // 로그인 사용자는 service 전용 확정 RPC를 실행할 수 없다.
  const finalize = await rpc(env, tokenA, 'finalize_upload', {
    p_asset_id: randomUUID(),
    p_uploader_id: accounts.a.userId,
    p_bytes: 10,
    p_width: 1,
    p_height: 1,
    p_verified_mime_type: 'image/png',
    p_request_id: randomUUID(),
  });
  expect(finalize.status >= 400).toBe(true);
  expect(finalize.code === '42501' || finalize.code === 'PGRST202').toBe(true);

  const stored = await select<{ title: string }[]>(env, tokenA, 'memories', `select=title&id=eq.${memoryId}`);
  expect(stored.data?.[0]?.title).toBe(`권한 ${RUN}`);
});

test('홈 고정은 두 사람의 홈 요약에 보이고, 해제하면 빠진다', async ({ browser }) => {
  const tokenA = await tokenFor(env, accounts.a);
  const title = `고정 ${RUN}`;
  const memoryId = await createMemoryViaApi(env, tokenA, { title, memoryDate: '2026-04-01' });

  const a = await openSession(browser, accounts.a);
  await a.page.goto(`/memories/${memoryId}`);
  await a.page.getByRole('button', { name: '홈에 고정' }).click();
  await expect(a.page.getByText('홈에 고정됨')).toBeVisible();

  const b = await openSession(browser, accounts.b);
  await b.page.goto('/');
  const pinnedSection = b.page.locator('section', { has: b.page.getByRole('heading', { name: '홈에 고정한 추억' }) });
  await expect(pinnedSection.getByRole('heading', { name: title })).toBeVisible();

  await a.page.getByRole('button', { name: '홈 고정 해제' }).click();
  await expect(a.page.getByText('홈에 고정됨')).toHaveCount(0);
  await b.page.reload();
  await expect(pinnedSection.getByRole('heading', { name: title })).toHaveCount(0);

  await a.context.close();
  await b.context.close();
});

test('고정 응답을 잃고 다시 눌러도 한 번만 반영된다(같은 스냅샷·같은 requestId 재생)', async ({ browser }) => {
  const tokenA = await tokenFor(env, accounts.a);
  const memoryId = await createMemoryViaApi(env, tokenA, {
    title: `고정 유실 ${RUN}`,
    memoryDate: '2026-04-03',
    tags: ['쉼표,있는 태그'],
    location: '성수',
  });

  const a = await openSession(browser, accounts.a);
  await a.page.goto(`/memories/${memoryId}`);

  let dropped = false;
  const detailPattern = new RegExp(`/memories/${memoryId}(\\?.*)?$`);
  await a.page.route(detailPattern, async (route) => {
    const request = route.request();
    if (!dropped && isServerActionRequest(request.method(), await request.allHeaders())) {
      dropped = true;
      await route.fetch().catch(() => undefined);
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });

  await a.page.getByRole('button', { name: '홈에 고정' }).click();
  await expect(a.page.getByText('요청을 처리하지 못했어요')).toBeVisible();
  const afterDrop = await select<{ is_pinned: boolean; version: number }[]>(
    env,
    tokenA,
    'memories',
    `select=is_pinned,version&id=eq.${memoryId}`,
  );
  expect(afterDrop.data?.[0]).toEqual({ is_pinned: true, version: 2 });

  await a.page.unroute(detailPattern);
  await a.page.getByRole('button', { name: '홈에 고정' }).click();
  await expect(a.page.getByText('홈에 고정됨')).toBeVisible();
  const afterRetry = await select<{ is_pinned: boolean; version: number }[]>(
    env,
    tokenA,
    'memories',
    `select=is_pinned,version&id=eq.${memoryId}`,
  );
  // 재시도가 새 저장이 아니라 재생이므로 버전이 더 오르지 않는다.
  expect(afterRetry.data?.[0]).toEqual({ is_pinned: true, version: 2 });

  await a.context.close();
});

test('상대가 먼저 고치면 고정은 충돌로 거부되고 상대 수정은 남는다', async ({ browser }) => {
  const tokenA = await tokenFor(env, accounts.a);
  const tokenB = await tokenFor(env, accounts.b);
  const title = `고정 충돌 ${RUN}`;
  const memoryId = await createMemoryViaApi(env, tokenA, { title, memoryDate: '2026-04-04' });

  const a = await openSession(browser, accounts.a);
  await a.page.goto(`/memories/${memoryId}`);
  await expect(a.page.getByRole('button', { name: '홈에 고정' })).toBeVisible();

  const peer = await rpc(env, tokenB, 'save_memory', {
    p_memory_id: memoryId,
    p_title: `${title} B 수정`,
    p_body: 'B 본문',
    p_memory_date: '2026-04-04',
    p_location: null,
    p_tags: [],
    p_photo_asset_ids: [],
    p_is_pinned: false,
    p_expected_version: 1,
    p_request_id: randomUUID(),
  });
  expect(peer.status).toBe(200);

  await a.page.getByRole('button', { name: '홈에 고정' }).click();
  await expect(a.page.getByText('상대방이 먼저 바꿨어요')).toBeVisible();
  const stored = await select<{ title: string; body: string; is_pinned: boolean; version: number }[]>(
    env,
    tokenA,
    'memories',
    `select=title,body,is_pinned,version&id=eq.${memoryId}`,
  );
  expect(stored.data?.[0]).toEqual({ title: `${title} B 수정`, body: 'B 본문', is_pinned: false, version: 2 });

  await a.page.getByRole('button', { name: '최신 내용 불러오기' }).click();
  await expect(a.page.getByRole('heading', { level: 1, name: `${title} B 수정` })).toBeVisible();
  await a.context.close();
});

test('삭제하면 두 사람 모두에게서 사라진다', async ({ browser }) => {
  const tokenA = await tokenFor(env, accounts.a);
  const title = `삭제 ${RUN}`;
  const memoryId = await createMemoryViaApi(env, tokenA, { title, memoryDate: '2026-04-02' });

  const a = await openSession(browser, accounts.a);
  await a.page.goto(`/memories/${memoryId}`);
  await a.page.getByRole('button', { name: '삭제' }).click();
  await a.page.getByRole('alertdialog').getByRole('button', { name: '삭제' }).click();
  await expect(a.page.getByRole('status').filter({ hasText: '기록을 지웠어요' })).toBeVisible();

  const b = await openSession(browser, accounts.b);
  await b.page.goto(`/memories/${memoryId}`);
  await expect(b.page.getByRole('heading', { name: NOT_FOUND_HEADING })).toBeVisible();
  expect(await countByTitle(env, tokenA, title)).toBe(0);

  await a.context.close();
  await b.context.close();
});

test('로그아웃하면 추억 화면과 사진 경로가 열리지 않는다', async ({ browser }) => {
  const a = await openSession(browser, accounts.a);
  await a.page.goto('/memories');
  await expect(a.page.getByRole('heading', { name: '추억', exact: true })).toBeVisible();
  const response = await a.page.request.get('/memories');
  expect(response.headers()['cache-control'] ?? '').toContain('no-store');

  await logout(a.page);
  await a.page.goto('/memories');
  await waitForScreen(a.page, ['login']);
  await a.page.goBack();
  await expect(a.page.getByRole('list', { name: '추억 목록' })).toHaveCount(0);

  const photo = await a.page.request.get(`/memories/photos/${randomUUID()}`);
  expect(photo.status()).toBe(404);
  await a.context.close();
});
