import { expect, test } from '@playwright/test';

/**
 * 데모 UI의 기본 흐름을 확인한다.
 * 브라우저 바이너리가 필요하므로 최초 1회 `pnpm exec playwright install`을 실행해야 한다.
 */

test('홈에 데모 모드 안내와 커버, 홈 섹션이 보인다', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('데모 모드').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '둘이 쌓는 공간', level: 1 })).toBeVisible();
  await expect(page.getByText(/함께한 지 .*일/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '최근 추억' })).toBeVisible();
});

test('추억 목록의 월 필터가 주소에 남고 뒤로 가기로 돌아온다', async ({ page }) => {
  await page.goto('/memories');

  const initialCards = await page.getByRole('listitem').filter({ has: page.getByRole('article') }).count();
  expect(initialCards).toBeGreaterThan(0);

  await page.getByRole('link', { name: '2026년 4월', exact: true }).click();
  await expect(page).toHaveURL(/month=2026-04/);

  await page.goBack();
  await expect(page).toHaveURL(/\/memories$/);
});

test('제목 없이 저장하면 오류 요약을 보여 준다', async ({ page }) => {
  await page.goto('/memories/new');

  await page.getByRole('button', { name: '기록 추가' }).click();

  await expect(page.getByText('입력을 1곳 확인해 주세요')).toBeVisible();
  await expect(page.getByText('제목을 입력해 주세요.').first()).toBeVisible();
  await expect(page.getByLabel(/제목/)).toBeFocused();
});

test('새 기록을 추가하면 데모 범위를 분명히 밝힌다', async ({ page }) => {
  await page.goto('/memories/new');

  await page.getByLabel(/제목/).fill('테스트 기록');
  await page.getByLabel(/날짜/).fill('2026-09-19');
  await page.getByRole('button', { name: '기록 추가' }).click();

  await expect(page.getByText('새 기록을 화면에 추가했어요')).toBeVisible();
  await expect(page.getByText(/브라우저 메모리에만 남습니다/)).toBeVisible();
});

test('맛집·설정은 준비 중 화면으로 표시한다', async ({ page }) => {
  await page.goto('/restaurants');
  await expect(page.getByText('준비 중')).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByText('준비 중')).toBeVisible();
});

test('없는 추억 주소는 찾을 수 없음 화면을 보여 준다', async ({ page }) => {
  await page.goto('/memories/does-not-exist');
  await expect(page.getByRole('heading', { name: '이 기록을 찾지 못했어요' })).toBeVisible();
});

/** 1x1 PNG. 외부 파일을 받지 않고 테스트 안에서 만든 최소 이미지다. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('커버 이미지를 고르면 미리보기가 생기고 적용하면 홈 커버에 반영된다', async ({ page }) => {
  await page.goto('/customize');

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'our-cover.png', mimeType: 'image/png', buffer: TINY_PNG });

  // 고른 파일 이름이 보이고, 적용 전에는 미저장 상태다.
  await expect(page.getByText('our-cover.png').first()).toBeVisible();
  await expect(page.getByText('아직 적용하지 않은 변경이 있어요.')).toBeVisible();

  await page.getByRole('button', { name: '적용', exact: true }).click();

  // 화면 안에서 이동한다. 전체 새로고침이면 데모 상태가 초기화되기 때문이다.
  // 하단 메뉴 대신 헤더의 공간 이름 링크를 쓴다. 개발 서버 오버레이가 하단을 가릴 수 있다.
  await page.getByRole('link', { name: '둘이 쌓는 공간' }).click();

  await expect(page.getByText(/커버 미리보기: our-cover\.png/)).toBeVisible();
  await expect(page.getByText(/업로드하지 않았고 상대방에게 전달되지 않아요/)).toBeVisible();

  // 저장하지 않으므로 새로고침하면 기본 커버로 돌아간다.
  await page.reload();
  await expect(page.getByText(/커버 미리보기: our-cover\.png/)).toBeHidden();
  await expect(page.getByText('커버 사진 업로드는 아직 없습니다.')).toBeVisible();
});

test('커버로 지원하지 않는 형식을 고르면 이유를 알려 준다', async ({ page }) => {
  await page.goto('/customize');

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'bad.gif', mimeType: 'image/gif', buffer: TINY_PNG });

  await expect(page.getByText(/JPEG·PNG·WebP 이미지만 올릴 수 있어요/)).toBeVisible();
  await expect(page.getByText('아직 적용하지 않은 변경이 있어요.')).toBeHidden();
});

test('커버를 고른 뒤 취소하면 원래 상태로 돌아간다', async ({ page }) => {
  await page.goto('/customize');

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'our-cover.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(page.getByText('our-cover.png').first()).toBeVisible();

  await page.getByRole('button', { name: '취소하고 되돌리기' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '되돌리기', exact: true })
    .click();

  await expect(page.getByText('고른 커버 이미지가 없습니다')).toBeVisible();
  await expect(page.getByText('아직 적용하지 않은 변경이 있어요.')).toBeHidden();
});

test('꾸미기 화면은 가로로 넘치지 않는다', async ({ page }) => {
  await page.goto('/customize');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('꾸미기에서 테마를 고르면 미리보기가 바뀌고 적용 전에는 되돌릴 수 있다', async ({ page }) => {
  await page.goto('/customize');

  // 테마 카드 버튼(설명 문구 포함)을 고른다. 같은 이름의 포인트 색상 버튼과 구분한다.
  await page.getByRole('button', { name: /^세이지 차분한 연녹색/ }).click();
  await expect(page.getByText('아직 적용하지 않은 변경이 있어요.')).toBeVisible();

  await page.getByRole('button', { name: '취소하고 되돌리기' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '되돌리기', exact: true })
    .click();
  await expect(page.getByText('아직 적용하지 않은 변경이 있어요.')).toBeHidden();
});
