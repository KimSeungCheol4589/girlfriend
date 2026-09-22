import { randomUUID } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import {
  isMissingObjectStatus,
  rpc,
  select,
  serviceDownload,
  serviceSelect,
  storageDownload,
  storagePublicDownload,
  storageUpload,
  syntheticPng,
  withExifOrientation6,
} from '../support/local-api';

import { NOT_FOUND_HEADING, openSession, requireEnv, runMarker, tokenFor, waitForMemoryDetail } from './helpers';
import { multipartBoundary, replaceMultipartFile } from './multipart';

/**
 * 실제 사진 업로드·확정·조회·정리(로컬 Supabase Storage + 앱 서버의 읽기 전용 sharp 검증 확정).
 *
 * 사진은 테스트 안에서 만든 합성 PNG뿐이다(실제 사진 없음). 일부 시나리오는 브라우저가 올리는
 * 요청 본문을 **바꿔치기**해 서버 확정기가 직접 거부하는지 확인한다(브라우저 전처리를 믿지 않는지).
 */

test.describe.configure({ mode: 'serial' });

const { env, accounts } = requireEnv();
const RUN = runMarker();
const BUCKET = 'space-assets';
const UPLOAD_PATTERN = `**/storage/v1/object/${BUCKET}/**`;

test.skip(process.env.MEM_TEST_PHOTOS === 'off', '사진 기능을 끈 실행에서는 photos-disabled.spec.ts가 대신 확인한다.');
test.skip(env.serviceKey === null, '업로드 결과를 서버 쪽에서 확인하려면 MEM_TEST_SERVICE_ROLE_KEY가 필요하다.');

type AssetRow = { id: string; state: string; width: number | null; height: number | null; object_path: string; mime_type: string };

async function assetRow(assetId: string): Promise<AssetRow | null> {
  const result = await serviceSelect<AssetRow[]>(
    env,
    'assets',
    `select=id,state,width,height,object_path,mime_type&id=eq.${assetId}`,
  );
  return result.data?.[0] ?? null;
}

async function choosePhoto(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'image/png', buffer });
}

async function readyAssetIds(page: Page, expected: number): Promise<string[]> {
  const ready = page.locator('li[data-photo-status="ready"]');
  await expect(ready).toHaveCount(expected, { timeout: 60_000 });
  return ready.evaluateAll((items) => items.map((item) => item.getAttribute('data-asset-id') ?? ''));
}

type Injection = { assetIds: string[]; reached: boolean[] };

/**
 * 다음 업로드의 **파일 파트 내용만** 바꿔치기한다(storage-js는 Blob을 multipart로 보낸다).
 * 사용자 세션의 실제 표준 업로드로 보낸 뒤, 응답을 브라우저에 넘기기 전에 service로 저장된 객체를 읽어
 * 주입한 바이트가 그 asset 경로에 그대로 들어갔는지 기록한다(`reached`). 확정은 그 뒤에 브라우저가 부른다.
 */
async function replaceNextUpload(
  page: Page,
  replace: (original: Buffer) => Promise<Buffer> | Buffer,
): Promise<Injection> {
  const seen: Injection = { assetIds: [], reached: [] };
  let used = false;
  await page.route(UPLOAD_PATTERN, async (route: Route) => {
    const request = route.request();
    if (used || request.method() !== 'POST') return route.continue();
    used = true;

    const pathname = decodeURIComponent(new URL(request.url()).pathname);
    const objectPath = pathname.split(`/storage/v1/object/${BUCKET}/`)[1] ?? '';
    const match = /\/([0-9a-f-]{36})\.(webp|jpg|png)$/.exec(pathname);
    if (match?.[1]) seen.assetIds.push(match[1]);

    const raw = request.postDataBuffer() ?? Buffer.alloc(0);
    const boundary = multipartBoundary((await request.headerValue('content-type')) ?? undefined);
    let body: Buffer;
    let injected: Buffer;
    if (boundary) {
      const probe = replaceMultipartFile(raw, boundary, (original) => original);
      if (!probe) {
        seen.reached.push(false);
        return route.continue();
      }
      injected = await replace(probe.original);
      body = replaceMultipartFile(raw, boundary, () => injected)?.body ?? raw;
    } else {
      injected = await replace(raw);
      body = injected;
    }

    const response = await route.fetch({ postData: body });
    const stored = response.ok() ? await serviceDownload(env, BUCKET, objectPath) : null;
    seen.reached.push(stored?.bytes !== null && stored?.bytes !== undefined && Buffer.from(stored.bytes).equals(injected));
    await route.fulfill({ response });
  });
  return seen;
}

let savedMemoryId = '';
let savedAssetId = '';

test('사진을 올리면 올린 사람만 먼저 보고, 저장 후에는 두 사람만 본다', async ({ browser }) => {
  const a = await openSession(browser, accounts.a);
  const b = await openSession(browser, accounts.b);
  const c = await openSession(browser, accounts.c);
  const anonymous = await browser.newContext();

  await a.page.goto('/memories/new');
  await choosePhoto(a.page, 'sunset.png', syntheticPng(1200, 900, [220, 140, 90], 'GPS 37.5,127.0'));
  const [assetId] = await readyAssetIds(a.page, 1);
  if (!assetId) throw new Error('asset ID 없음');

  // 브라우저가 정규화해 한 번 올린 파일을 서버가 검증해 기록한 실제 값(텍스트 메타데이터 없음)
  const row = await assetRow(assetId);
  expect(row?.state).toBe('ready');
  expect(row?.width).toBe(1200);
  expect(row?.height).toBe(900);
  const stored = await serviceDownload(env, BUCKET, row?.object_path ?? '');
  expect(stored.status).toBe(200);
  expect(Buffer.from(stored.bytes ?? new Uint8Array()).includes(Buffer.from('GPS 37.5'))).toBe(false);

  // 저장 전(미첨부): 업로더만
  const photoPath = `/memories/photos/${assetId}`;
  const own = await a.page.request.get(photoPath);
  expect(own.status()).toBe(200);
  expect(own.headers()['cache-control'] ?? '').toContain('no-store');
  expect(own.headers()['content-type']).toBe(row?.mime_type);
  expect((await b.page.request.get(photoPath)).status()).toBe(404);
  expect((await c.page.request.get(photoPath)).status()).toBe(404);
  expect((await anonymous.request.get(photoPath)).status()).toBe(404);

  // 직접 Storage·REST 접근도 같은 규칙
  const tokenB = await tokenFor(env, accounts.b);
  const tokenC = await tokenFor(env, accounts.c);
  expect((await storageDownload(env, tokenB, BUCKET, row?.object_path ?? '')).status).not.toBe(200);
  expect((await storageDownload(env, null, BUCKET, row?.object_path ?? '')).status).not.toBe(200);
  expect(await storagePublicDownload(env, BUCKET, row?.object_path ?? '')).not.toBe(200);
  expect((await select<unknown[]>(env, tokenB, 'assets', `select=id&id=eq.${assetId}`)).data).toEqual([]);

  // B는 A의 미첨부 사진을 자기 기록에 붙일 수 없다(존재를 알리지 않는 NOT_FOUND).
  const hijack = await rpc(env, tokenB, 'save_memory', {
    p_memory_id: null,
    p_title: `가로채기 ${RUN}`,
    p_body: '',
    p_memory_date: '2026-05-01',
    p_location: null,
    p_tags: [],
    p_photo_asset_ids: [assetId],
    p_is_pinned: false,
    p_expected_version: 0,
    p_request_id: randomUUID(),
  });
  expect(hijack.code).toBe('GF404');

  // 저장
  const title = `사진 기록 ${RUN}`;
  await a.page.getByLabel('제목').fill(title);
  await a.page.getByRole('button', { name: '기록 저장' }).click();
  savedMemoryId = await waitForMemoryDetail(a.page, title);
  savedAssetId = assetId;
  await expect(a.page.getByRole('img', { name: `${title} 사진 1` })).toBeVisible();

  // 저장 후: 같은 공간 구성원만
  expect((await b.page.request.get(photoPath)).status()).toBe(200);
  expect((await c.page.request.get(photoPath)).status()).toBe(404);
  expect((await anonymous.request.get(photoPath)).status()).toBe(404);
  expect((await storageDownload(env, tokenB, BUCKET, row?.object_path ?? '')).status).toBe(200);
  expect((await storageDownload(env, tokenC, BUCKET, row?.object_path ?? '')).status).not.toBe(200);

  await b.page.goto(`/memories/${savedMemoryId}`);
  await expect(b.page.getByRole('img', { name: `${title} 사진 1` })).toBeVisible();

  for (const session of [a, b, c]) await session.context.close();
  await anonymous.close();
});

test('브라우저를 거치지 않고 EXIF가 남은 JPEG가 올라오면 서버가 거부하고 정리한다(재인코딩·덮어쓰기 없음)', async ({ browser }) => {
  const a = await openSession(browser, accounts.a);
  // 브라우저가 WebP를 못 만드는 것처럼 해 JPEG 경로를 쓰게 한다.
  await a.page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type, quality) {
      return original.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality);
    };
  });
  await a.page.goto('/memories/new');

  // 브라우저가 만든 JPEG에 EXIF(방향 6)를 끼워 올린다 = 전처리를 우회한 업로드.
  const seen = await replaceNextUpload(a.page, (original) => withExifOrientation6(original));
  await choosePhoto(a.page, 'rotated.png', syntheticPng(300, 100, [30, 90, 200]));
  const failed = a.page.locator('li[data-photo-status="failed"]');
  await expect(failed).toHaveCount(1, { timeout: 60_000 });
  await expect(failed.getByText('사진 정보(위치 등)가 남아 있어')).toBeVisible();

  const rejectedId = seen.assetIds[0] ?? '';
  // 주입한 EXIF JPEG가 실제로 그 asset 경로에 저장된 뒤 서버가 거부했다.
  expect(seen.reached).toEqual([true]);
  const row = await assetRow(rejectedId);
  expect(row?.mime_type).toBe('image/jpeg');
  expect(row?.state).toBe('deleting');
  expect(isMissingObjectStatus((await serviceDownload(env, BUCKET, row?.object_path ?? '')).status)).toBe(true);

  // 가로채기 없이 다시 시도하면 브라우저가 정규화한 파일이 새 asset으로 확정된다(방향은 브라우저가 반영).
  await a.page.unroute(UPLOAD_PATTERN);
  await failed.getByRole('button', { name: '다시 시도' }).click();
  const [assetId] = await readyAssetIds(a.page, 1);
  expect(assetId === rejectedId).toBe(false);
  const accepted = await assetRow(assetId ?? '');
  expect([accepted?.width, accepted?.height]).toEqual([300, 100]);
  const stored = await serviceDownload(env, BUCKET, accepted?.object_path ?? '');
  expect(Buffer.from(stored.bytes ?? new Uint8Array()).includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);

  // 저장하지 않고 빼면 정리된다(deleting + 객체 삭제).
  await a.page.getByRole('button', { name: '1번째 사진 빼기' }).click();
  await expect.poll(async () => (await assetRow(assetId ?? ''))?.state).toBe('deleting');
  await expect
    .poll(async () => isMissingObjectStatus((await serviceDownload(env, BUCKET, accepted?.object_path ?? '')).status))
    .toBe(true);

  await a.context.close();
});

test('서버는 형식 불일치·40MP 초과·손상 파일을 거부하고 파일을 정리하며, 다시 시도하면 새로 올린다', async ({ browser }) => {
  const a = await openSession(browser, accounts.a);
  await a.page.goto('/memories/new');
  await a.page.getByLabel('제목').fill(`거부 후 재시도 ${RUN}`);

  const cases: { name: string; message: string; replace: (original: Buffer) => Promise<Buffer> | Buffer }[] = [
    {
      name: '형식 불일치(PNG 바이트를 WebP로)',
      message: '파일 형식이 확인한 내용과 달라요',
      replace: () => syntheticPng(64, 64, [0, 0, 0]),
    },
    {
      name: '40MP 초과',
      message: '4천만 화소를 넘는 사진은 올릴 수 없어요',
      replace: async () => {
        const base64 = await a.page.evaluate(async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 8000;
          canvas.height = 5001;
          const context = canvas.getContext('2d');
          if (context) {
            context.fillStyle = '#88aa55';
            context.fillRect(0, 0, canvas.width, canvas.height);
          }
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.5));
          if (!blob || blob.type !== 'image/webp') return '';
          const buffer = new Uint8Array(await blob.arrayBuffer());
          let binary = '';
          for (const byte of buffer) binary += String.fromCharCode(byte);
          return btoa(binary);
        });
        expect(base64.length > 0, '브라우저가 40MP WebP를 만들지 못함').toBe(true);
        return Buffer.from(base64, 'base64');
      },
    },
    {
      name: '손상 파일(잘린 WebP)',
      message: '사진을 읽지 못했어요',
      replace: (original) => original.subarray(0, Math.max(40, Math.floor(original.length / 3))),
    },
  ];

  for (const [index, item] of cases.entries()) {
    const seen = await replaceNextUpload(a.page, item.replace);
    await choosePhoto(a.page, `case-${index}.png`, syntheticPng(400, 300, [index * 40, 100, 150]));
    const failed = a.page.locator('li[data-photo-status="failed"]');
    await expect(failed, item.name).toHaveCount(1, { timeout: 60_000 });
    await expect(failed.getByText(item.message), item.name).toBeVisible();

    const rejectedId = seen.assetIds[0] ?? '';
    expect(seen.reached, `${item.name}: 주입 바이트가 저장됨`).toEqual([true]);
    const row = await assetRow(rejectedId);
    expect(row?.state, item.name).toBe('deleting');
    expect(isMissingObjectStatus((await serviceDownload(env, BUCKET, row?.object_path ?? '')).status), item.name).toBe(
      true,
    );

    // 가로채기를 풀고 다시 시도하면 선택한 사진을 그대로 새 asset으로 올린다.
    await a.page.unroute(UPLOAD_PATTERN);
    await failed.getByRole('button', { name: '다시 시도' }).click();
    const ids = await readyAssetIds(a.page, index + 1);
    expect(ids.includes(rejectedId), item.name).toBe(false);
  }

  // 제목·사진을 유지한 채 저장된다.
  await expect(a.page.getByLabel('제목')).toHaveValue(`거부 후 재시도 ${RUN}`);
  await a.page.getByRole('button', { name: '기록 저장' }).click();
  await waitForMemoryDetail(a.page, `거부 후 재시도 ${RUN}`);
  await expect(a.page.getByRole('button', { name: /번째 사진 보기/ })).toHaveCount(3);

  await a.context.close();
});

test('저장하지 않고 앱 안에서 떠나면(메뉴 이동·뒤로 가기) 올린 사진을 정리한다', async ({ browser }) => {
  const a = await openSession(browser, accounts.a);
  const listHeading = a.page.getByRole('heading', { name: '월·태그로 추리기' });

  async function expectCleaned(assetId: string): Promise<void> {
    const objectPath = (await assetRow(assetId))?.object_path ?? '';
    await expect.poll(async () => (await assetRow(assetId))?.state, { timeout: 30_000 }).toBe('deleting');
    await expect
      .poll(async () => isMissingObjectStatus((await serviceDownload(env, BUCKET, objectPath)).status), {
        timeout: 30_000,
      })
      .toBe(true);
  }

  // 1) 메뉴 링크(클라이언트 이동) → 미저장 확인 → 이동
  await a.page.goto('/memories');
  await expect(listHeading).toBeVisible();
  await a.page.getByRole('link', { name: '새 추억 쓰기' }).first().click();
  await expect(a.page.getByRole('heading', { name: '새 추억' })).toBeVisible();
  await choosePhoto(a.page, 'leave-menu.png', syntheticPng(320, 240, [10, 160, 90]));
  const [viaMenu] = await readyAssetIds(a.page, 1);
  await a.page.getByRole('link', { name: '추억', exact: true }).filter({ visible: true }).first().click();
  await a.page.getByRole('alertdialog').getByRole('button', { name: '이동하기' }).click();
  await expect(listHeading).toBeVisible();
  await expectCleaned(viaMenu ?? '');

  // 2) 브라우저 뒤로 가기(App Router의 클라이언트 이동, 페이지 새로고침 아님)
  await a.page.getByRole('link', { name: '새 추억 쓰기' }).first().click();
  await expect(a.page.getByRole('heading', { name: '새 추억' })).toBeVisible();
  await choosePhoto(a.page, 'leave-back.png', syntheticPng(320, 240, [160, 10, 90]));
  const [viaBack] = await readyAssetIds(a.page, 1);
  await a.page.goBack();
  await expect(listHeading).toBeVisible();
  await expectCleaned(viaBack ?? '');

  await a.context.close();
});

test('사용자는 발급된 경로 밖에 올리거나 덮어쓸 수 없다', async () => {
  const token = await tokenFor(env, accounts.a);
  const png = syntheticPng(16, 16, [5, 5, 5]);
  const prepared = await rpc<{ assetId: string; bucket: string; objectPath: string }>(env, token, 'prepare_upload', {
    p_purpose: 'memory',
    p_mime_type: 'image/png',
    p_bytes: png.byteLength,
    p_request_id: randomUUID(),
  });
  const asset = prepared.data;
  if (!asset) throw new Error('prepare_upload 응답 없음');

  expect(await storageUpload(env, token, BUCKET, asset.objectPath, png, 'image/png')).toBe(200);
  // 같은 경로 덮어쓰기(upsert) 거부
  expect(await storageUpload(env, token, BUCKET, asset.objectPath, png, 'image/png', true)).not.toBe(200);
  // 발급받지 않은 경로 거부
  const [spaceId] = asset.objectPath.split('/');
  expect(await storageUpload(env, token, BUCKET, `${spaceId}/${randomUUID()}.png`, png, 'image/png')).not.toBe(200);
  // 비로그인 업로드 거부
  expect(await storageUpload(env, null, BUCKET, `${spaceId}/${randomUUID()}.png`, png, 'image/png')).not.toBe(200);

  // 정리: 취소하면 deleting이 되고 업로더도 더는 읽을 수 없다.
  const discarded = await rpc(env, token, 'discard_upload', { p_asset_id: asset.assetId, p_request_id: randomUUID() });
  expect(discarded.status).toBe(200);
  expect((await storageDownload(env, token, BUCKET, asset.objectPath)).status).not.toBe(200);
});

test('사진이 붙은 기록을 지우면 파일이 정리되고 누구도 볼 수 없다', async ({ browser }) => {
  test.skip(savedMemoryId === '', '첫 시나리오가 실패해 저장된 사진 기록이 없다.');
  const a = await openSession(browser, accounts.a);
  const b = await openSession(browser, accounts.b);
  const row = await assetRow(savedAssetId);
  const objectPath = row?.object_path ?? '';

  await a.page.goto(`/memories/${savedMemoryId}`);
  await a.page.getByRole('button', { name: '삭제' }).click();
  await a.page.getByRole('alertdialog').getByRole('button', { name: '삭제' }).click();
  // 정리 성공이면 보류 문구가 없다.
  const notice = a.page.getByRole('status').filter({ hasText: '기록을 지웠어요' });
  await expect(notice).toBeVisible();
  await expect(notice).not.toContainText('정리는 끝나지 않아');

  expect((await assetRow(savedAssetId))?.state).toBe('deleting');
  expect(isMissingObjectStatus((await serviceDownload(env, BUCKET, objectPath)).status)).toBe(true);
  expect((await a.page.request.get(`/memories/photos/${savedAssetId}`)).status()).toBe(404);
  expect((await b.page.request.get(`/memories/photos/${savedAssetId}`)).status()).toBe(404);
  await b.page.goto(`/memories/${savedMemoryId}`);
  await expect(b.page.getByRole('heading', { name: NOT_FOUND_HEADING })).toBeVisible();

  await a.context.close();
  await b.context.close();
});
