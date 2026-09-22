import { expect, test, type Page } from '@playwright/test';

import { isMissingObjectStatus, select, serviceDownload, serviceSelect, syntheticPng } from '../support/local-api';

import { hasHorizontalOverflow, openSession, requireEnv, runMarker, tokenFor, waitForMemoryDetail } from './helpers';

/**
 * 모바일 화면(375×812)에서 사진 두 장 기록·순서 저장, 그리고 상대가 기존 사진 하나를 뺐을 때
 * 빠진 파일만 정리되고 남은 사진은 그대로인지(실제 로컬 Supabase + 앱 서버).
 */

test.describe.configure({ mode: 'serial' });

const { env, accounts } = requireEnv();
const RUN = runMarker();
const BUCKET = 'space-assets';
const MOBILE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };

test.skip(process.env.MEM_TEST_PHOTOS === 'off', '사진 기능을 끈 실행에서는 건너뛴다.');
test.skip(env.serviceKey === null, '서버 쪽 확인에 MEM_TEST_SERVICE_ROLE_KEY가 필요하다.');

type AssetRow = { state: string; object_path: string };

async function assetRow(assetId: string): Promise<AssetRow | null> {
  const result = await serviceSelect<AssetRow[]>(env, 'assets', `select=state,object_path&id=eq.${assetId}`);
  return result.data?.[0] ?? null;
}

async function readyAssetIds(page: Page, expected: number): Promise<string[]> {
  const ready = page.locator('li[data-photo-status="ready"]');
  await expect(ready).toHaveCount(expected, { timeout: 60_000 });
  return ready.evaluateAll((items) => items.map((item) => item.getAttribute('data-asset-id') ?? ''));
}

async function attachedOrder(token: string, memoryId: string): Promise<string[]> {
  const result = await select<{ asset_id: string }[]>(
    env,
    token,
    'memory_photos',
    `select=asset_id&memory_id=eq.${memoryId}&order=sort_order.asc`,
  );
  return (result.data ?? []).map((row) => row.asset_id);
}

test('모바일: 사진 두 장의 순서를 바꿔 저장하고, 상대가 하나를 빼면 그 파일만 정리된다', async ({ browser }) => {
  const tokenA = await tokenFor(env, accounts.a);
  const a = await openSession(browser, accounts.a, MOBILE);
  const title = `모바일 순서 ${RUN}`;

  await a.page.goto('/memories/new');
  await expect(a.page.getByRole('heading', { name: '새 추억' })).toBeVisible();
  await a.page.getByLabel('제목').fill(title);
  await a.page.locator('input[type=file]').setInputFiles([
    { name: 'first.png', mimeType: 'image/png', buffer: syntheticPng(900, 600, [200, 60, 60]) },
    { name: 'second.png', mimeType: 'image/png', buffer: syntheticPng(600, 900, [60, 60, 200]) },
  ]);
  const [first, second] = await readyAssetIds(a.page, 2);
  if (!first || !second) throw new Error('asset ID 없음');
  expect(await hasHorizontalOverflow(a.page)).toBe(false);

  // 두 번째 사진을 앞으로(대표 사진 변경)
  await a.page.getByRole('button', { name: '2번째 사진 앞으로' }).click();
  await expect(a.page.locator('li[data-photo-status]').first()).toHaveAttribute('data-asset-id', second);

  await a.page.getByRole('button', { name: '기록 저장' }).click();
  const memoryId = await waitForMemoryDetail(a.page, title);
  expect(await attachedOrder(tokenA, memoryId)).toEqual([second, first]);
  await expect(a.page.getByRole('img', { name: `${title} 사진 1` })).toBeVisible();
  expect(await hasHorizontalOverflow(a.page)).toBe(false);

  // 상대(B, 모바일)가 기존 사진 중 대표(second)를 빼고 저장
  const b = await openSession(browser, accounts.b, MOBILE);
  await b.page.goto(`/memories/${memoryId}/edit`);
  await expect(b.page.getByRole('heading', { name: '기록 수정' })).toBeVisible();
  await expect(b.page.locator('li[data-photo-status]').first()).toHaveAttribute('data-asset-id', second);
  expect(await hasHorizontalOverflow(b.page)).toBe(false);
  await b.page.getByRole('button', { name: '1번째 사진 빼기' }).click();
  await b.page.getByRole('button', { name: '수정 내용 저장' }).click();
  await waitForMemoryDetail(b.page, title);
  await expect(b.page.getByRole('status').filter({ hasText: '저장했어요' })).not.toContainText('정리는 끝나지 않아');

  // 남은 사진은 그대로, 빠진 사진은 deleting + 객체 삭제 + 누구에게도 404
  expect(await attachedOrder(tokenA, memoryId)).toEqual([first]);
  const kept = await assetRow(first);
  const detached = await assetRow(second);
  expect(kept?.state).toBe('ready');
  expect((await serviceDownload(env, BUCKET, kept?.object_path ?? '')).status).toBe(200);
  expect(detached?.state).toBe('deleting');
  expect(isMissingObjectStatus((await serviceDownload(env, BUCKET, detached?.object_path ?? '')).status)).toBe(true);
  expect((await a.page.request.get(`/memories/photos/${second}`)).status()).toBe(404);
  expect((await b.page.request.get(`/memories/photos/${second}`)).status()).toBe(404);
  expect((await a.page.request.get(`/memories/photos/${first}`)).status()).toBe(200);

  await a.page.reload();
  await expect(a.page.getByRole('img', { name: `${title} 사진 1` })).toBeVisible();
  await expect(a.page.getByRole('button', { name: /번째 사진 보기/ })).toHaveCount(0);

  await a.context.close();
  await b.context.close();
});
