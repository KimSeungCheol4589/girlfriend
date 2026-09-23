import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  isMissingObjectStatus,
  rpc,
  select,
  serviceDownload,
  serviceSelect,
  storageUpload,
  syntheticPng,
} from '../support/local-api';

import {
  SAVE_BUTTON,
  cancelToSaved,
  confirmDialogButton,
  coverFile,
  coverUrlFor,
  editorAlert,
  expectRpcError,
  homeCoverImage,
  saveSettingsViaApi,
  openCustomize,
  openSession,
  otherThemeThan,
  readSettings,
  requireEnv,
  resetSettings,
  themeButton,
  tokenFor,
  type Session,
} from './helpers';

/**
 * 커버 사진 E2E (로컬 Supabase, 합성 계정 theme-e2e).
 *
 * 확인하는 것
 *   - 올린 사진은 **저장을 눌러야** 공유 커버가 된다. 저장 전 취소하면 그 파일만 정리된다.
 *   - 교체·해제하면 이전 커버만 정리되고, 저장된 커버가 재시도로 사라지지 않는다.
 *   - 사진 조회 경로는 업로더·상대 구성원에게만 열리고 외부 계정·비로그인·다른 용도 파일에는 404다.
 *   - 상대가 올린 커버는 그대로 **유지**할 수 있지만, 남의 파일을 새 커버로 붙일 수는 없다.
 */

const { env, accounts } = requireEnv();
const BUCKET = 'space-assets';

test.describe.configure({ mode: 'serial' });

test.describe('커버 사진', () => {
  let a: Session;
  let tokenA = '';
  let tokenB = '';

  test.beforeAll(async ({ browser }) => {
    tokenA = await tokenFor(env, accounts.a);
    tokenB = await tokenFor(env, accounts.b);
    await resetSettings(env, tokenA);
    a = await openSession(browser, accounts.a);
  });

  test.afterAll(async () => {
    await a?.context.close();
    const current = await readSettings(env, tokenA);
    if (current.cover_asset_id) {
      await rpc(env, tokenA, 'save_customization', {
        p_theme_key: current.theme_key,
        p_accent_color: current.accent_color,
        p_cover_asset_id: null,
        p_home_sections: current.home_sections,
        p_expected_version: current.version,
        p_request_id: randomUUID(),
      });
    }
  });

  async function uploadCover(session: Session): Promise<void> {
    await session.page.getByLabel('사진 고르기').setInputFiles(coverFile());
    await expect(session.page.getByText('사진 확인이 끝났어요')).toBeVisible();
  }

  /**
   * A가 올린 커버 파일 ID 전부(상태를 가리지 않는다).
   *
   * 앞선 검증이 남긴 `deleting` 파일도 함께 들어 있다. 그래서 "새로 생긴 파일"을 찾을 때는
   * **행동 직전의 목록을 찍어 두고** 그 목록에 없는 것을 기다려야 한다. 단순히 "가장 최근 파일"을
   * 고르면 직전 검증이 버린 파일을 가리킬 수 있다.
   */
  async function ownCoverIds(): Promise<string[]> {
    const rows = await serviceSelect<{ id: string }[]>(
      env,
      'assets',
      `select=id&purpose=eq.cover&uploader_id=eq.${accounts.a.userId}&order=created_at.desc&limit=50`,
    );
    return (rows.data ?? []).map((row) => row.id);
  }

  /**
   * 찍어 둔 목록에 없는 커버 파일이 생길 때까지 기다린다.
   * 화면이 asset ID를 노출하지 않으므로 경쟁·정리 시나리오에서 "그 파일"을 지목하려면 필요하다.
   */
  async function waitForNewOwnCover(known: readonly string[]): Promise<string> {
    const skip = new Set(known.filter((id) => id.length > 0));
    let found = '';
    await expect
      .poll(
        async () => {
          found = (await ownCoverIds()).find((id) => !skip.has(id)) ?? '';
          return found.length > 0;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    return found;
  }

  async function assetRow(assetId: string) {
    const result = await serviceSelect<{ state: string; purpose: string; uploader_id: string; object_path: string }[]>(
      env,
      'assets',
      `select=state,purpose,uploader_id,object_path&id=eq.${assetId}`,
    );
    return result.data?.[0] ?? null;
  }

  test('올린 사진은 저장해야 공유 커버가 된다', async () => {
    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);

    await uploadCover(a);
    // 확정만으로는 공유 설정이 바뀌지 않는다.
    const during = await readSettings(env, tokenA);
    expect(during.cover_asset_id).toBe(before.cover_asset_id);
    expect(during.version).toBe(before.version);

    await a.page.getByRole('button', { name: SAVE_BUTTON }).click();
    await expect(a.page.getByText('꾸미기 설정을 저장했어요')).toBeVisible();

    const saved = await readSettings(env, tokenA);
    expect(saved.cover_asset_id).not.toBeNull();
    const row = await assetRow(saved.cover_asset_id ?? '');
    expect(row?.purpose).toBe('cover');
    expect(row?.state).toBe('ready');
    expect(row?.uploader_id).toBe(accounts.a.userId);
  });

  test('홈 커버가 인증된 경로로 보인다(업로더와 상대 구성원 모두)', async ({ browser }) => {
    const saved = await readSettings(env, tokenA);
    const coverId = saved.cover_asset_id ?? '';
    expect(coverId.length).toBeGreaterThan(0);

    // 커버가 홈에서 사라지는 원인을 층별로 구분한다(메타데이터 → 파일 → 화면).
    // 1) 계약(CONTRACTS.md 6): 붙어 있는 ready 파일의 메타데이터는 구성원이 읽을 수 있어야 한다.
    const ownerSeesAsset = await select<{ id: string }[]>(env, tokenA, 'assets', `select=id&id=eq.${coverId}`);
    expect(ownerSeesAsset.data?.length, '업로더가 자기 커버 메타데이터를 읽는다').toBe(1);
    const peerSeesAsset = await select<{ id: string }[]>(env, tokenB, 'assets', `select=id&id=eq.${coverId}`);
    expect(peerSeesAsset.data?.length, '상대 구성원이 붙은 커버 메타데이터를 읽는다').toBe(1);

    // 2) 경로가 실제 사진 바이트를 돌려주는지 본다. 여기서 실패하면 조회 권한 문제이고,
    //    화면에서 실패하면 렌더 문제다(커버가 사라진 이유를 섞지 않기 위해 순서를 고정한다).
    const own = await a.page.request.get(coverUrlFor(coverId));
    expect(own.status(), '업로더 본인의 커버 조회').toBe(200);
    expect(own.headers()['content-type']).toContain('image/');
    expect(own.headers()['cache-control']).toContain('no-store');
    expect((await own.body()).byteLength).toBeGreaterThan(0);

    // 3) 홈이 그 경로로 실제 이미지를 그린다(불러오지 못하면 컴포넌트가 스스로 숨기므로 사라진다).
    await a.page.goto('/');
    const image = homeCoverImage(a.page);
    await expect(image, '홈 커버 이미지').toBeVisible();
    await expect(image).toHaveAttribute('src', coverUrlFor(coverId));

    const b = await openSession(browser, accounts.b);
    const peer = await b.page.request.get(coverUrlFor(coverId));
    expect(peer.status(), '상대 구성원의 커버 조회').toBe(200);
    await b.page.goto('/');
    await expect(homeCoverImage(b.page), '상대 구성원 홈 커버 이미지').toBeVisible();
    await expect(homeCoverImage(b.page)).toHaveAttribute('src', coverUrlFor(coverId));
    await b.context.close();
  });

  test('외부 계정과 비로그인은 커버를 내려받을 수 없다', async ({ browser, request }) => {
    const saved = await readSettings(env, tokenA);
    const coverId = saved.cover_asset_id ?? '';

    const c = await openSession(browser, accounts.c);
    expect((await c.page.request.get(`/customize/cover/${coverId}`)).status()).toBe(404);
    await c.context.close();

    // `request` 픽스처는 브라우저 쿠키를 공유하지 않는다(비로그인 요청).
    expect((await request.get(`/customize/cover/${coverId}`)).status()).toBe(404);
    // 형식이 틀린 ID·없는 ID도 같은 404다(존재 여부를 알리지 않는다).
    expect((await request.get('/customize/cover/not-a-uuid')).status()).toBe(404);
  });

  test('추억용으로 올린 파일은 커버 경로로 열리지 않고 커버로 저장되지도 않는다', async () => {
    // 추억 용도로 준비·업로드한 파일(확정하지 않아도 용도는 memory다).
    const prepared = await rpc<{ assetId: string; objectPath: string }>(env, tokenA, 'prepare_upload', {
      p_purpose: 'memory',
      p_mime_type: 'image/png',
      p_bytes: 512,
      p_request_id: randomUUID(),
    });
    const assetId = prepared.data?.assetId ?? '';
    const objectPath = prepared.data?.objectPath ?? '';
    expect(assetId.length).toBeGreaterThan(0);
    expect(await storageUpload(env, tokenA, BUCKET, objectPath, syntheticPng(8, 8, [1, 2, 3]), 'image/png')).toBe(200);

    // 커버 조회 경로(비공개 GET)는 실제 HTTP 404다.
    expect((await a.page.request.get(`/customize/cover/${assetId}`)).status()).toBe(404);

    // DB도 다른 용도의 파일을 커버로 붙이지 않는다(RPC는 SQLSTATE로 판단한다).
    const settings = await readSettings(env, tokenA);
    const rejected = await rpc(env, tokenA, 'save_customization', {
      p_theme_key: settings.theme_key,
      p_accent_color: settings.accent_color,
      p_cover_asset_id: assetId,
      p_home_sections: settings.home_sections,
      p_expected_version: settings.version,
      p_request_id: randomUUID(),
    });
    // 내 파일이지만 용도가 다르면 **검증 실패**다(GF422). 존재 여부를 숨길 이유가 없기 때문이다.
    // 남의 파일·다른 공간은 그보다 앞선 검사에서 NOT_FOUND로 통일된다(아래 상대 구성원 검증 참고).
    // 기준: 20260919140100_attachment_ownership_and_conflict_mapping.sql의 save_customization.
    expectRpcError(rejected, 'GF422', '추억용 파일을 커버로 지정', { coverAssetId: 'purpose' });

    // 거부된 저장은 아무것도 바꾸지 않는다(버전·커버 모두).
    const unchanged = await readSettings(env, tokenA);
    expect(unchanged.version).toBe(settings.version);
    expect(unchanged.cover_asset_id).toBe(settings.cover_asset_id);

    await rpc(env, tokenA, 'discard_upload', { p_asset_id: assetId, p_request_id: randomUUID() });
  });

  test('상대 구성원은 기존 커버를 유지할 수 있지만 남의 파일을 새 커버로 붙일 수 없다', async ({ browser }) => {
    const before = await readSettings(env, tokenA);
    const coverId = before.cover_asset_id ?? '';
    expect(coverId.length).toBeGreaterThan(0);

    // B가 테마만 바꿔 저장해도 커버는 그대로 남는다.
    const b = await openSession(browser, accounts.b);
    await openCustomize(b.page);
    // 새 커버를 지정할 수 있는 사람이 누구인지 상대에게도 알려 준다.
    // (누가 올렸는지 확인하지 못한 경우에도 이 문장은 같다. 문구 전체를 고정하지 않는다.)
    await expect(b.page.getByText('새 커버는 올린 사람만 지정할 수 있습니다')).toBeVisible();

    // 지금 저장된 값과 **다른** 테마를 고른다. 같은 값을 다시 고르면 바뀐 것이 없어 저장 버튼이
    // 계속 비활성이다(앞선 검증이 남긴 테마에 따라 달라지므로 값을 고정하지 않는다).
    const next = otherThemeThan(before.theme_key);
    const saveButton = b.page.getByRole('button', { name: SAVE_BUTTON });
    await expect(saveButton, '불러온 직후에는 저장할 변경이 없다').toBeDisabled();
    await themeButton(b.page, next.label).click();
    await expect(saveButton, '바꾼 뒤에는 저장할 수 있다').toBeEnabled();
    await saveButton.click();
    await expect(b.page.getByText('꾸미기 설정을 저장했어요')).toBeVisible();
    await b.context.close();

    // 상대가 테마만 바꿔 저장해도 커버는 그대로 남는다.
    const after = await readSettings(env, tokenB);
    expect(after.cover_asset_id, '상대 저장이 커버를 떼어 내지 않는다').toBe(coverId);
    expect(after.theme_key).toBe(next.key);
    expect(after.version).toBe(before.version + 1);
    expect((await assetRow(coverId))?.state).toBe('ready');

    // A가 올린 **미첨부** 파일을 B가 커버로 지정하려 하면 존재 여부를 알리지 않고 거부한다.
    const prepared = await rpc<{ assetId: string; objectPath: string }>(env, tokenA, 'prepare_upload', {
      p_purpose: 'cover',
      p_mime_type: 'image/png',
      p_bytes: 512,
      p_request_id: randomUUID(),
    });
    const foreignAsset = prepared.data?.assetId ?? '';
    const rejected = await rpc(env, tokenB, 'save_customization', {
      p_theme_key: after.theme_key,
      p_accent_color: after.accent_color,
      p_cover_asset_id: foreignAsset,
      p_home_sections: after.home_sections,
      p_expected_version: after.version,
      p_request_id: randomUUID(),
    });
    // 업로더가 다르면 용도·상태를 보기 전에 존재 여부를 알리지 않고 거부한다(NOT_FOUND로 통일).
    expectRpcError(rejected, 'GF404', '상대가 올린 파일을 새 커버로 지정', { coverAssetId: 'missing' });
    const unchanged = await readSettings(env, tokenB);
    expect(unchanged.cover_asset_id).toBe(coverId);
    expect(unchanged.version).toBe(after.version);

    await rpc(env, tokenA, 'discard_upload', { p_asset_id: foreignAsset, p_request_id: randomUUID() });
  });

  test('커버를 교체하면 이전 커버만 정리된다', async () => {
    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);
    const oldCover = before.cover_asset_id ?? '';
    const oldPath = (await assetRow(oldCover))?.object_path ?? '';

    await uploadCover(a);
    await a.page.getByRole('button', { name: SAVE_BUTTON }).click();
    await expect(a.page.getByText('꾸미기 설정을 저장했어요')).toBeVisible();

    const after = await readSettings(env, tokenA);
    expect(after.cover_asset_id).not.toBe(oldCover);
    expect((await assetRow(after.cover_asset_id ?? ''))?.state).toBe('ready');

    // 이전 커버는 참조가 끊기고 정리 대상이 된다. 새 커버 객체는 그대로다.
    expect((await assetRow(oldCover))?.state).toBe('deleting');
    expect(isMissingObjectStatus((await serviceDownload(env, BUCKET, oldPath)).status)).toBe(true);
    const newPath = (await assetRow(after.cover_asset_id ?? ''))?.object_path ?? '';
    expect((await serviceDownload(env, BUCKET, newPath)).status).toBe(200);
  });

  test('저장한 뒤 같은 저장을 다시 보내도 커버가 지워지지 않는다(응답 유실 재시도)', async () => {
    const saved = await readSettings(env, tokenA);
    const coverId = saved.cover_asset_id ?? '';
    const requestId = randomUUID();

    const first = await rpc<{ version: number }>(env, tokenA, 'save_customization', {
      p_theme_key: saved.theme_key,
      p_accent_color: saved.accent_color,
      p_cover_asset_id: coverId,
      p_home_sections: saved.home_sections,
      p_expected_version: saved.version,
      p_request_id: requestId,
    });
    expect(first.status).toBe(200);

    // 같은 requestId·같은 입력 = 같은 결과를 되돌려준다(두 번 반영되지 않는다).
    const retried = await rpc<{ version: number }>(env, tokenA, 'save_customization', {
      p_theme_key: saved.theme_key,
      p_accent_color: saved.accent_color,
      p_cover_asset_id: coverId,
      p_home_sections: saved.home_sections,
      p_expected_version: saved.version,
      p_request_id: requestId,
    });
    expect(retried.status).toBe(200);
    expect(retried.data?.version).toBe(first.data?.version);

    // 커밋된 커버는 살아 있다.
    const after = await readSettings(env, tokenA);
    expect(after.cover_asset_id).toBe(coverId);
    expect((await assetRow(coverId))?.state).toBe('ready');
    const path = (await assetRow(coverId))?.object_path ?? '';
    expect((await serviceDownload(env, BUCKET, path)).status).toBe(200);

    // 첨부된 커버는 취소 요청으로도 사라지지 않는다(CONTRACTS.md 2: 이미 첨부됨 → GF409).
    const discard = await rpc(env, tokenA, 'discard_upload', {
      p_asset_id: coverId,
      p_request_id: randomUUID(),
    });
    expectRpcError(discard, 'GF409', '첨부된 커버 취소');
    expect((await assetRow(coverId))?.state).toBe('ready');
  });

  test('저장하지 않고 취소하면 올린 파일만 정리된다', async () => {
    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);

    // 화면은 대기 파일 ID를 노출하지 않는다. 올리기 직전 목록을 찍어 두고 새로 생긴 파일을 지목한다.
    const existing = await ownCoverIds();
    await uploadCover(a);
    const pendingId = await waitForNewOwnCover(existing);

    await cancelToSaved(a.page);

    await expect
      .poll(async () => (await assetRow(pendingId))?.state, { timeout: 15_000 })
      .toBe('deleting');

    // 저장된 커버는 그대로다.
    const after = await readSettings(env, tokenA);
    expect(after.cover_asset_id).toBe(before.cover_asset_id);
    expect(after.version).toBe(before.version);
    if (after.cover_asset_id) {
      expect((await assetRow(after.cover_asset_id))?.state).toBe('ready');
    }
  });

  test('빠르게 두 번 고르면 이전 파일만 정리되고 마지막 파일이 커버가 된다', async () => {
    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);
    const existing = await ownCoverIds();

    // 첫 파일이 **실제로 asset을 만든 뒤** 곧바로 다른 파일로 바꾼다. 그래야 경쟁이 성립한다.
    // (이전 파이프라인의 뒤늦은 취소가 방금 올린 파일을 지우면 안 된다.)
    const input = a.page.getByLabel('사진 고르기');
    await input.setInputFiles(coverFile('first.png'));
    const firstAssetId = await waitForNewOwnCover(existing);
    await input.setInputFiles(coverFile('second.png'));

    await expect(a.page.getByText('사진 확인이 끝났어요')).toBeVisible();
    await expect(a.page.getByText('second.png')).toBeVisible();
    const secondAssetId = await waitForNewOwnCover([...existing, firstAssetId]);
    expect(secondAssetId).not.toBe(firstAssetId);

    await a.page.getByRole('button', { name: SAVE_BUTTON }).click();
    await expect(a.page.getByText('꾸미기 설정을 저장했어요')).toBeVisible();

    const after = await readSettings(env, tokenA);
    expect(after.cover_asset_id, '마지막으로 고른 파일이 커버가 된다').toBe(secondAssetId);
    expect(after.cover_asset_id, '이전 커버가 실제로 교체됐다').not.toBe(before.cover_asset_id);
    expect(after.version, '저장은 한 번만 반영된다').toBe(before.version + 1);

    // 저장된(마지막) 파일은 살아 있어야 한다. 경쟁이 잘못되면 여기서 deleting이 된다.
    expect((await assetRow(secondAssetId))?.state).toBe('ready');
    expect((await a.page.request.get(coverUrlFor(secondAssetId))).status()).toBe(200);

    // 먼저 고른 파일은 커버로 붙지 않고 정리된다.
    await expect
      .poll(async () => (await assetRow(firstAssetId))?.state, { timeout: 20_000 })
      .toBe('deleting');
  });

  test('확정된 커버를 실패하는 파일로 바꿔도 초안은 저장 가능한 값으로 남는다', async () => {
    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);
    expect(before.cover_asset_id, '이 검증은 저장된 커버가 있을 때를 본다').not.toBeNull();
    const existing = await ownCoverIds();

    // A: 정상 파일을 올려 확정까지 간다(초안 커버 = A).
    const input = a.page.getByLabel('사진 고르기');
    await input.setInputFiles(coverFile('good.png'));
    await expect(a.page.getByText('사진 확인이 끝났어요')).toBeVisible();
    const pendingId = await waitForNewOwnCover(existing);
    // 초안이 저장된 커버와 달라졌으므로 되돌리기 선택지가 보인다.
    await expect(a.page.getByRole('button', { name: '저장된 커버로 되돌리기' })).toBeVisible();

    // B: 이미지가 아닌 내용을 올려 브라우저 정규화 단계에서 실패시킨다.
    await input.setInputFiles({
      name: 'broken.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not an image at all'),
    });
    await expect(editorAlert(a.page), '업로드 실패는 소리로도 알린다').toContainText('JPEG·PNG·WebP');

    // A는 교체 시점에 정리된다. 초안이 A를 계속 가리키면 저장할 수 없는 값이 남는다.
    await expect
      .poll(async () => (await assetRow(pendingId))?.state, { timeout: 20_000 })
      .toBe('deleting');
    await expect(
      a.page.getByRole('button', { name: '저장된 커버로 되돌리기' }),
      '초안이 저장된 커버로 되돌아왔다',
    ).toHaveCount(0);
    await expect(
      a.page.getByRole('button', { name: SAVE_BUTTON }),
      '되돌아왔으므로 저장할 변경이 없다',
    ).toBeDisabled();

    // 설정과 저장된 커버는 그대로다.
    const after = await readSettings(env, tokenA);
    expect(after.cover_asset_id).toBe(before.cover_asset_id);
    expect(after.version).toBe(before.version);
    expect((await assetRow(before.cover_asset_id ?? ''))?.state).toBe('ready');
  });

  test('충돌 뒤 최신 설정을 불러오면 올리던 커버 초안도 함께 정리된다', async () => {
    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);
    const existing = await ownCoverIds();

    await uploadCover(a);
    const pendingId = await waitForNewOwnCover(existing);

    // 화면이 열려 있는 동안 상대가 먼저 저장해 버전을 올린다.
    await saveSettingsViaApi(env, tokenB, {
      themeKey: before.theme_key,
      accentColor: before.accent_color,
      coverAssetId: before.cover_asset_id,
      sections: before.home_sections,
      expectedVersion: before.version,
    });

    await a.page.getByRole('button', { name: SAVE_BUTTON }).click();
    await expect(editorAlert(a.page)).toContainText('상대방이 먼저 저장했어요');

    // 사용자가 고르던 값을 버리기로 한다. 올려 둔 대기 파일도 함께 정리돼야 한다.
    await a.page.getByRole('button', { name: /최신 설정 불러오기/ }).click();
    await expect(a.page.getByText('최신 설정을 불러왔어요')).toBeVisible();
    await expect(a.page.getByText('사진 확인이 끝났어요')).toHaveCount(0);
    await expect(a.page.getByRole('button', { name: SAVE_BUTTON })).toBeDisabled();

    await expect
      .poll(async () => (await assetRow(pendingId))?.state, { timeout: 20_000 })
      .toBe('deleting');

    // 상대가 저장한 커버는 그대로다.
    const after = await readSettings(env, tokenA);
    expect(after.cover_asset_id).toBe(before.cover_asset_id);
  });

  test('저장하지 않고 메뉴로 나가면 올린 파일을 정리한다', async () => {
    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);

    const existing = await ownCoverIds();
    await uploadCover(a);
    const pendingId = await waitForNewOwnCover(existing);

    // 앱 안의 메뉴 이동: 미저장 확인 대화상자를 거쳐 화면을 떠난다(화면이 내려가며 정리한다).
    await a.page.getByRole('link', { name: '홈', exact: true }).first().click();
    await confirmDialogButton(a.page, '이동하기').click();
    await expect(a.page.getByRole('heading', { name: '우리 공간 구성원' })).toBeVisible();

    await expect
      .poll(async () => (await assetRow(pendingId))?.state, { timeout: 15_000 })
      .toBe('deleting');

    // 저장된 설정과 커버는 그대로다.
    const after = await readSettings(env, tokenA);
    expect(after.cover_asset_id).toBe(before.cover_asset_id);
    expect(after.version).toBe(before.version);
  });

  test('커버를 없애고 저장하면 설정에서 빠지고 파일이 정리된다', async () => {
    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);
    const coverId = before.cover_asset_id ?? '';
    const path = (await assetRow(coverId))?.object_path ?? '';

    await a.page.getByRole('button', { name: '커버 없애기' }).click();
    await a.page.getByRole('button', { name: SAVE_BUTTON }).click();
    await expect(a.page.getByText('꾸미기 설정을 저장했어요')).toBeVisible();

    const after = await readSettings(env, tokenA);
    expect(after.cover_asset_id).toBeNull();
    expect((await assetRow(coverId))?.state).toBe('deleting');
    expect(isMissingObjectStatus((await serviceDownload(env, BUCKET, path)).status)).toBe(true);

    // 홈은 다시 테마 배경만 보여 준다.
    await a.page.goto('/');
    await expect(homeCoverImage(a.page)).toHaveCount(0);
  });
});
