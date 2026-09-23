import { expect, test } from '@playwright/test';

import {
  SAVE_BUTTON,
  accentPresetButton,
  cancelToSaved,
  createMemoryViaApi,
  editorAlert,
  hasHorizontalOverflow,
  openCustomize,
  openSession,
  otherThemeThan,
  readSettings,
  requireEnv,
  resetSettings,
  runMarker,
  saveSettingsViaApi,
  themeButton,
  tokenFor,
  type Session,
} from './helpers';

/**
 * 실제 꾸미기 저장 E2E (로컬 Supabase, 합성 계정 theme-e2e).
 *
 * 확인하는 것
 *   - 저장이 **공유 설정**을 바꾸고 새로고침·재로그인·상대방 화면에 그대로 남는다.
 *   - 미리보기는 저장 전 어떤 공유 상태도 바꾸지 않는다(문서 테마·DB 모두).
 *   - 충돌·실패에서 고른 값이 사라지지 않고, 상대 저장을 덮어쓰지 않는다.
 *   - 추억 고정은 꾸미기 저장과 **따로** 성공·실패한다.
 */

const { env, accounts } = requireEnv();

test.describe.configure({ mode: 'serial' });

test.describe('꾸미기 실제 저장', () => {
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
    await resetSettings(env, tokenA);
  });

  test('데모 화면이 아니라 실제 편집기를 보여 준다', async () => {
    await openCustomize(a.page);
    await expect(a.page.getByRole('button', { name: SAVE_BUTTON })).toBeVisible();
    // 데모 고지·데모 전용 문구가 실제 화면에 섞이지 않는다.
    await expect(a.page.getByText('데모 모드입니다')).toHaveCount(0);
    await expect(a.page.getByText('예시 데이터로 되돌리기')).toHaveCount(0);
  });

  test('미리보기는 저장 전에 문서 테마도 공유 설정도 바꾸지 않는다', async () => {
    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);

    // 저장된 값과 다른 테마를 고른다(같은 값이면 바뀐 것이 없어 취소·저장 버튼이 비활성이다).
    const next = otherThemeThan(before.theme_key);
    await themeButton(a.page, next.label).click();

    const preview = a.page.getByTestId('customize-preview');
    await expect(preview).toHaveAttribute('data-theme', next.key);
    // 문서 전체 테마는 마지막으로 저장된 값 그대로다.
    await expect(a.page.locator('html')).toHaveAttribute('data-theme', before.theme_key);

    const after = await readSettings(env, tokenA);
    expect(after.theme_key).toBe(before.theme_key);
    expect(after.version).toBe(before.version);

    await cancelToSaved(a.page);
  });

  test('취소는 마지막으로 저장한 값으로 되돌린다', async () => {
    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);

    await themeButton(a.page, '로즈').click();
    // 프리셋 버튼도 초안만 바꾼다(이름이 테마와 겹쳐 색상 목록 안에서 정확히 고른다).
    await accentPresetButton(a.page, '흐린 하늘').click();
    await expect(a.page.getByLabel('직접 입력')).toHaveValue('#4f6d8c');
    await expect(a.page.getByText('아직 저장하지 않은 변경이 있어요.')).toBeVisible();

    await cancelToSaved(a.page);

    await expect(a.page.getByText('아직 저장하지 않은 변경이 있어요.')).toHaveCount(0);
    await expect(a.page.getByLabel('직접 입력')).toHaveValue(before.accent_color);

    const after = await readSettings(env, tokenA);
    expect(after.version).toBe(before.version);
  });

  test('저장하면 공유 설정이 바뀌고 새로고침·재로그인 후에도 남는다', async ({ browser }) => {
    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);

    await themeButton(a.page, '세이지').click();
    await a.page.getByLabel('직접 입력').fill('#6f8f72');
    await a.page.getByRole('button', { name: SAVE_BUTTON }).click();
    await expect(a.page.getByText('꾸미기 설정을 저장했어요')).toBeVisible();

    const saved = await readSettings(env, tokenA);
    expect(saved.theme_key).toBe('sage');
    expect(saved.accent_color).toBe('#6f8f72');
    expect(saved.version).toBe(before.version + 1);

    // 새로고침: 저장된 값이 그대로 보이고 미저장 표시가 없다.
    await openCustomize(a.page);
    await expect(a.page.getByLabel('직접 입력')).toHaveValue('#6f8f72');
    await expect(themeButton(a.page, '세이지')).toHaveAttribute('aria-pressed', 'true');
    await expect(a.page.locator('html')).toHaveAttribute('data-theme', 'sage');

    // 새 컨텍스트에서 다시 로그인해도(쿠키·화면 상태를 공유하지 않는다) 같은 설정이다.
    const relogged = await openSession(browser, accounts.a);
    await openCustomize(relogged.page);
    await expect(themeButton(relogged.page, '세이지')).toHaveAttribute('aria-pressed', 'true');
    await expect(relogged.page.locator('html')).toHaveAttribute('data-theme', 'sage');
    await relogged.context.close();
  });

  test('상대방이 새로고침하면 같은 설정을 본다', async ({ browser }) => {
    const current = await readSettings(env, tokenA);
    await saveSettingsViaApi(env, tokenA, {
      themeKey: 'rose',
      accentColor: '#c06c82',
      coverAssetId: current.cover_asset_id,
      expectedVersion: current.version,
    });

    const b = await openSession(browser, accounts.b);
    await openCustomize(b.page);
    await expect(themeButton(b.page, '로즈')).toHaveAttribute('aria-pressed', 'true');
    await expect(b.page.locator('html')).toHaveAttribute('data-theme', 'rose');
    await b.context.close();
  });

  test('상대방이 먼저 저장했으면 덮어쓰지 않고 고른 값을 남긴다', async () => {
    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);

    // 화면이 열려 있는 동안 상대(B)가 먼저 저장한다.
    await saveSettingsViaApi(env, tokenB, {
      themeKey: 'cream',
      accentColor: '#a9713f',
      coverAssetId: before.cover_asset_id,
      expectedVersion: before.version,
    });

    await themeButton(a.page, '세이지').click();
    await a.page.getByRole('button', { name: SAVE_BUTTON }).click();

    // 본문 안의 안내만 본다(Next의 라우트 안내 요소도 role=alert라서 범위를 좁힌다).
    const alert = editorAlert(a.page);
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText('상대방이 먼저 저장했어요');
    // 고른 값은 그대로 남아 있다.
    await expect(themeButton(a.page, '세이지')).toHaveAttribute('aria-pressed', 'true');

    // 상대가 저장한 값이 덮이지 않았다.
    const afterConflict = await readSettings(env, tokenA);
    expect(afterConflict.accent_color).toBe('#a9713f');
    expect(afterConflict.theme_key).toBe('cream');

    // 되돌리는 선택은 사용자 몫이다. 안내 안에 그 선택지가 있어야 한다.
    const reload = alert.getByRole('button', { name: /최신 설정 불러오기/ });
    await expect(reload).toBeVisible();

    // 사용자가 직접 고를 때에만 최신 값으로 바뀐다.
    await reload.click();
    await expect(a.page.getByText('최신 설정을 불러왔어요')).toBeVisible();
    await expect(themeButton(a.page, '크림')).toHaveAttribute('aria-pressed', 'true');

    // 불러온 뒤에는 같은 저장이 통과한다.
    await themeButton(a.page, '세이지').click();
    await a.page.getByRole('button', { name: SAVE_BUTTON }).click();
    await expect(a.page.getByText('꾸미기 설정을 저장했어요')).toBeVisible();
    expect((await readSettings(env, tokenA)).theme_key).toBe('sage');
  });

  test('같은 저장을 두 번 눌러도 버전이 한 번만 올라간다(중복 제출 방지)', async () => {
    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);

    // 앞선 검증이 남긴 테마에 기대지 않는다. 지금 값과 다른 테마를 골라야 저장할 변경이 생긴다.
    const next = otherThemeThan(before.theme_key);
    const button = a.page.getByRole('button', { name: SAVE_BUTTON });
    await themeButton(a.page, next.label).click();
    await expect(button).toBeEnabled();
    await button.click();
    await expect(a.page.getByText('꾸미기 설정을 저장했어요')).toBeVisible();

    // 이미 저장된 값과 같으므로 버튼이 비활성화된다(같은 저장을 다시 보내지 않는다).
    await expect(button).toBeDisabled();
    const after = await readSettings(env, tokenA);
    expect(after.theme_key).toBe(next.key);
    expect(after.version).toBe(before.version + 1);
  });

  test('홈은 저장된 순서·표시 설정을 따른다', async () => {
    const current = await readSettings(env, tokenA);
    await saveSettingsViaApi(env, tokenA, {
      themeKey: current.theme_key,
      accentColor: current.accent_color,
      coverAssetId: current.cover_asset_id,
      expectedVersion: current.version,
      sections: [
        { key: 'wishlist', visible: true },
        { key: 'recentMemories', visible: true },
        { key: 'pinned', visible: false },
      ],
    });

    await a.page.goto('/');
    await expect(a.page.getByRole('heading', { name: '다음에 가고 싶은 맛집' })).toBeVisible();
    await expect(a.page.getByRole('heading', { name: '홈에 고정한 추억' })).toHaveCount(0);

    const order = await a.page.evaluate(() =>
      Array.from(document.querySelectorAll('section[aria-labelledby^="section-"]')).map((node) =>
        node.getAttribute('aria-labelledby'),
      ),
    );
    expect(order.indexOf('section-wishlist')).toBeLessThan(order.indexOf('section-recent'));
  });

  test('모든 섹션을 숨기면 홈이 그 사실을 알린다', async () => {
    const current = await readSettings(env, tokenA);
    await saveSettingsViaApi(env, tokenA, {
      themeKey: current.theme_key,
      accentColor: current.accent_color,
      coverAssetId: current.cover_asset_id,
      expectedVersion: current.version,
      sections: [
        { key: 'pinned', visible: false },
        { key: 'recentMemories', visible: false },
        { key: 'wishlist', visible: false },
      ],
    });

    await a.page.goto('/');
    await expect(a.page.getByText('홈 섹션을 모두 숨겼습니다')).toBeVisible();
    await expect(a.page.getByRole('heading', { name: '최근 추억' })).toHaveCount(0);
    // 공간 정보는 그대로 보인다(빈 화면이 아니다).
    await expect(a.page.getByRole('heading', { name: '우리 공간 구성원' })).toBeVisible();
  });

  test('꾸미기 화면에서 섹션 순서를 바꿔 저장할 수 있다', async () => {
    await openCustomize(a.page);
    await a.page.getByRole('button', { name: '최근 추억 위로' }).click();
    await a.page.getByRole('button', { name: '홈에 고정한 추억 표시하기' }).click();
    await a.page.getByRole('button', { name: SAVE_BUTTON }).click();
    await expect(a.page.getByText('꾸미기 설정을 저장했어요')).toBeVisible();

    const saved = await readSettings(env, tokenA);
    expect(saved.home_sections.map((section) => section.key)[0]).toBe('recentMemories');
    expect(saved.home_sections.find((section) => section.key === 'pinned')?.visible).toBe(true);
  });

  test('추억 고정은 꾸미기 저장과 따로 저장된다', async () => {
    const marker = runMarker();
    const title = `고정 후보 ${marker}`;
    await createMemoryViaApi(env, tokenA, { title, memoryDate: '2026-03-03' });

    await openCustomize(a.page);
    const before = await readSettings(env, tokenA);

    const row = a.page.locator('li', { hasText: title }).first();
    await row.getByRole('button', { name: '고정 안 함' }).click();
    await expect(row.getByText('아직 저장하지 않은 고정 변경이에요.')).toBeVisible();

    await row.getByRole('button', { name: '고정 저장' }).click();
    await expect(row.getByText('이 추억의 고정 상태만 저장했어요.')).toBeVisible();

    // 꾸미기 설정 버전은 그대로다(같은 저장으로 묶이지 않는다).
    const after = await readSettings(env, tokenA);
    expect(after.version).toBe(before.version);

    // 홈에 고정된 추억으로 보인다.
    await a.page.goto('/');
    await expect(a.page.getByRole('heading', { name: '홈에 고정한 추억' })).toBeVisible();
    await expect(a.page.getByText(title).first()).toBeVisible();
  });

  test('취소는 저장하지 않은 고정 초안만 되돌린다(저장한 고정은 유지)', async () => {
    const marker = runMarker();
    const pinned = `이미 고정 ${marker}`;
    const draftOnly = `초안 고정 ${marker}`;
    await createMemoryViaApi(env, tokenA, { title: pinned, memoryDate: '2026-02-02', isPinned: true });
    await createMemoryViaApi(env, tokenA, { title: draftOnly, memoryDate: '2026-02-01' });

    await openCustomize(a.page);
    const draftRow = a.page.locator('li', { hasText: draftOnly }).first();
    await draftRow.getByRole('button', { name: '고정 안 함' }).click();

    await cancelToSaved(a.page);

    // 초안은 사라지고, 이미 저장된 고정은 그대로다.
    await expect(draftRow.getByRole('button', { name: '고정 안 함' })).toBeVisible();
    await expect(a.page.locator('li', { hasText: pinned }).first().getByRole('button', { name: '홈에 고정' })).toBeVisible();
  });

  test('모바일 폭에서도 가로 스크롤이 생기지 않는다', async ({ browser }) => {
    const mobile = await openSession(browser, accounts.a, { viewport: { width: 390, height: 844 } });
    await openCustomize(mobile.page);
    expect(await hasHorizontalOverflow(mobile.page)).toBe(false);

    await mobile.page.goto('/');
    expect(await hasHorizontalOverflow(mobile.page)).toBe(false);
    await mobile.context.close();
  });
});
