import { expect, test } from '@playwright/test';

import {
  apiWish,
  createWishViaUi,
  failOnDialog,
  gotoDetail,
  gotoWishes,
  loadWishAccounts,
  login,
  openAs,
  seoulDateInDays,
  koreanDate,
  uniqueTitle,
  userClient,
} from './helpers';

/**
 * 두 구성원의 공유 CRUD와 상태 전이.
 *
 * - A가 만든 위시를 B가 고치고 상태를 바꾸고 지울 수 있다(공유 기록).
 * - 상태는 wish → planned → done이 기본 흐름이고, 되돌리면 계획한 날짜가 지워진다.
 * - 계획일은 선택이며 **미래 날짜가 정상**이다(맛집 방문일과 다른 점).
 * - 사용자가 넣은 문자열은 텍스트로만 그려진다(스크립트로 실행되지 않는다).
 * - 위시 상세에서 해당 위시를 연결한 캘린더 일정 만들기로 이동한다.
 */

const accounts = loadWishAccounts();

test.describe.configure({ mode: 'serial' });

test('A가 위시를 만들고 B가 같은 위시를 보고 고친다', async ({ browser }) => {
  const a = await openAs(browser, accounts.a);
  const b = await openAs(browser, accounts.b);

  try {
    const title = uniqueTitle('한강 야경');
    const id = await createWishViaUi(a.page, {
      title,
      category: 'activity',
      linkUrl: 'https://example.invalid/hangang',
      memo: '자전거 타고 가기',
    });

    // 새 위시는 '하고 싶어요'로 저장된다.
    await expect(a.page.getByText('하고 싶어요', { exact: false }).first()).toBeVisible();
    await expect(a.page.getByRole('link', { name: /링크 열기/ })).toBeVisible();
    await expect(a.page.getByText('자전거 타고 가기')).toBeVisible();

    // B의 목록에도 보인다.
    await gotoWishes(b.page);
    await expect(b.page.getByRole('link', { name: new RegExp(title) })).toBeVisible();

    // B가 내용을 고친다(작성자가 아니어도 된다).
    await b.page.goto(`/wishes/${id}/edit`);
    await expect(b.page.getByRole('heading', { name: '위시 수정' })).toBeVisible();
    await b.page.getByLabel('메모').fill('B가 고친 메모');
    await b.page.getByLabel('분류').selectOption('trip');
    await b.page.getByRole('button', { name: '변경 저장' }).click();
    await expect(b.page.getByText('B가 고친 메모')).toBeVisible();
    await expect(b.page.getByText('여행', { exact: false }).first()).toBeVisible();

    // A가 새로 고치면 B의 변경이 보인다.
    await gotoDetail(a.page, id);
    await expect(a.page.getByText('B가 고친 메모')).toBeVisible();

    // 작성자는 바뀌지 않는다.
    const api = await userClient(accounts.a);
    const row = await apiWish(api, id);
    expect(row?.category).toBe('trip');
    expect(row?.memo).toBe('B가 고친 메모');
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('상태 전이: 계획 → 완료 → 되돌리기에서 계획일이 함께 관리된다', async ({ page }) => {
  await login(page, accounts.a);
  const title = uniqueTitle('전시 보기');
  const id = await createWishViaUi(page, { title, category: 'place' });
  const future = seoulDateInDays(30);

  const api = await userClient(accounts.a);

  /**
   * 저장 결과는 **저장된 상태**로 확인한다.
   *
   * 화면의 안내 문구는 클라이언트 상태라서 개발 서버의 Fast Refresh가 끼어들면 사라질 수 있다.
   * 무엇이 저장됐는지가 이 테스트의 관심사이므로 DB 상태가 기대값이 될 때까지 기다린다.
   */
  async function expectSaved(expected: { status: string; plannedDate: string | null }) {
    await expect
      .poll(async () => {
        const row = await apiWish(api, id);
        return { status: row?.status, plannedDate: row?.planned_date ?? null };
      })
      .toEqual(expected);
  }

  // 계획일은 미래 날짜가 정상이다.
  await page.getByLabel('계획한 날짜').fill(future);
  await page.getByRole('button', { name: '계획했어요로 바꾸기' }).click();
  await expectSaved({ status: 'planned', plannedDate: future });

  // 서버가 그린 상세까지 반영된 뒤 다음 조작을 한다.
  await expect(page.getByText(`${koreanDate(future)}에 하기로 했어요`)).toBeVisible();
  await expect(page.getByLabel('계획한 날짜')).toHaveValue(future);

  // 날짜만 바꾸기(상태 유지)
  const other = seoulDateInDays(45);
  await page.getByLabel('계획한 날짜').fill(other);
  // 입력이 실제로 반영됐고 저장 버튼이 열렸는지 먼저 확인한다(값이 조용히 되돌아가면 여기서 잡힌다).
  await expect(page.getByLabel('계획한 날짜')).toHaveValue(other);
  const saveDateOnly = page.getByRole('button', { name: '날짜만 저장' });
  await expect(saveDateOnly).toBeEnabled();
  await saveDateOnly.click();
  await expectSaved({ status: 'planned', plannedDate: other });

  // 완료해도 날짜는 기록으로 남는다.
  await expect(page.getByText(`${koreanDate(other)}에 하기로 했어요`)).toBeVisible();
  await page.getByRole('button', { name: '해냈어요로 바꾸기' }).click();
  await expectSaved({ status: 'done', plannedDate: other });

  // 되돌리면 계획일이 지워진다.
  await expect(page.getByText(`${koreanDate(other)}에 해냈어요`)).toBeVisible();
  await page.getByRole('button', { name: '하고 싶어요로 바꾸기' }).click();
  await expectSaved({ status: 'wish', plannedDate: null });

  // 'wish' 상태에는 계획일 입력이 남아 있지 않다.
  await expect(page.getByLabel('계획한 날짜')).toHaveValue('');
});

test('위시에서 연결된 캘린더 일정을 만들 수 있다', async ({ page }) => {
  await login(page, accounts.a);
  const id = await createWishViaUi(page, { title: uniqueTitle('일정 안내') });
  await gotoDetail(page, id);

  const createEvent = page.getByRole('link', { name: '이 위시로 일정 만들기' });
  await expect(createEvent).toHaveAttribute('href', `/calendar/new?wishId=${id}`);
});

test('입력 오류는 필드에 표시되고 저장하지 않는다', async ({ page }) => {
  await login(page, accounts.a);
  await page.goto('/wishes/new');
  await expect(page.getByRole('heading', { name: '위시 추가' })).toBeVisible();

  // 제목 없이 제출. 안내는 상단 요약과 해당 필드 두 곳에 나오므로 첫 번째만 본다.
  await page.getByLabel('링크').fill('http://example.invalid/insecure');
  await page.getByRole('button', { name: '위시 등록' }).click();
  await expect(page.getByText('제목을(를) 입력해 주세요.').first()).toBeVisible();
  // 저장되지 않아 여전히 등록 화면이다.
  await expect(page).toHaveURL(/\/wishes\/new$/);

  // https가 아닌 링크
  const title = uniqueTitle('링크 검증');
  await page.getByLabel('제목').fill(title);
  await page.getByRole('button', { name: '위시 등록' }).click();
  await expect(page.getByText(/https:\/\/로 시작하는 주소만/).first()).toBeVisible();
  await expect(page).toHaveURL(/\/wishes\/new$/);

  // 고치면 저장된다. 입력한 제목은 그대로 남아 있다.
  await expect(page.getByLabel('제목')).toHaveValue(title);
  await page.getByLabel('링크').fill('https://example.invalid/ok');
  await page.getByRole('button', { name: '위시 등록' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});

test('사용자 문자열은 텍스트로만 그려진다', async ({ page }) => {
  const dialog = failOnDialog(page);
  await login(page, accounts.a);

  const title = uniqueTitle('<img src=x onerror=alert(1)>');
  const id = await createWishViaUi(page, {
    title,
    memo: '<script>alert(2)</script>',
  });

  await gotoDetail(page, id);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('<script>alert(2)</script>')).toBeVisible();
  expect(dialog.triggered()).toBe(false);
});

test('B가 위시를 삭제하면 두 사람 목록에서 사라진다', async ({ browser }) => {
  const a = await openAs(browser, accounts.a);
  const b = await openAs(browser, accounts.b);

  try {
    const title = uniqueTitle('삭제 대상');
    const id = await createWishViaUi(a.page, { title });

    await gotoDetail(b.page, id);
    await b.page.getByRole('button', { name: '위시 삭제' }).click();
    await b.page.getByRole('button', { name: '삭제', exact: true }).click();

    await expect(b.page).toHaveURL(/\/wishes(\?|$)/);
    await expect(b.page.getByRole('link', { name: new RegExp(title) })).toHaveCount(0);

    // A가 다시 들어가면 404 화면이다(존재 여부를 구분하지 않는다).
    await a.page.goto(`/wishes/${id}`);
    await expect(a.page.getByRole('heading', { name: '이 위시를 찾지 못했어요' })).toBeVisible();

    const api = await userClient(accounts.a);
    expect(await apiWish(api, id)).toBeNull();
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
