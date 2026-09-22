import { expect, test } from '@playwright/test';

import {
  apiCreateRestaurant,
  apiRestaurant,
  apiReviews,
  apiSetVisited,
  createRestaurantViaUi,
  failOnDialog,
  gotoDetail,
  gotoRestaurants,
  loadFoodAccounts,
  login,
  openAs,
  RUN_TAG,
  seoulDateDaysAgo,
  uniqueName,
  userClient,
} from './helpers';
import { FUTURE_VISIT_MESSAGE } from './messages';

/**
 * A·B 공유 CRUD(실제 로컬 Supabase, 실제 로그인).
 *
 * 전제: `node tests/restaurants/fixtures/cli.mjs setup` — A·B는 같은 공간, C는 다른 공간.
 */

const accounts = loadFoodAccounts();

test.describe.configure({ mode: 'serial' });

test('A가 만든 맛집을 B가 보고 고치며, 각자 자기 후기만 쓰고 고치고 지운다', async ({ browser }) => {
  const a = await openAs(browser, accounts.a);
  const b = await openAs(browser, accounts.b);
  const name = uniqueName('공유');

  try {
    // A 등록
    const id = await createRestaurantViaUi(a.page, {
      name,
      area: '성수',
      category: '양식',
      mapUrl: 'https://map.naver.com/p/entry/place/1',
      memo: 'A의 메모',
    });
    await expect(a.page.getByText('가고 싶은 곳').first()).toBeVisible();
    await expect(a.page.getByRole('link', { name: /지도에서 열기/ })).toHaveAttribute(
      'href',
      'https://map.naver.com/p/entry/place/1',
    );
    await expect(a.page.getByRole('link', { name: /지도에서 열기/ })).toHaveAttribute('rel', /noopener/);

    // B가 목록 검색으로 찾고 정보 수정
    await gotoRestaurants(b.page, `?q=${encodeURIComponent(name)}`);
    await b.page.getByRole('link', { name: new RegExp(name) }).click();
    await expect(b.page.getByRole('heading', { name })).toBeVisible();
    await b.page.getByRole('link', { name: '정보 수정' }).click();
    await expect(b.page.getByRole('heading', { name: '맛집 정보 수정' })).toBeVisible();
    await b.page.getByLabel('메모').fill('B가 고친 메모');
    await b.page.getByRole('button', { name: '변경 저장' }).click();
    await expect(b.page.getByText('B가 고친 메모')).toBeVisible();

    // A가 새로 불러오면 B의 변경이 보인다
    await gotoDetail(a.page, id);
    await expect(a.page.getByText('B가 고친 메모')).toBeVisible();

    // A가 방문 처리
    const visitDate = seoulDateDaysAgo(2);
    await a.page.getByLabel('방문일').fill(visitDate);
    await expect(a.page.getByLabel('방문일')).toHaveValue(visitDate);
    await a.page.getByRole('button', { name: '다녀왔어요' }).click();
    await expect(a.page.getByText(/다녀온 곳으로 저장했어요/)).toBeVisible();
    // 고른 날짜가 실제로 저장됐는지(입력이 오늘 날짜로 덮어쓰이지 않았는지) DB로 확인한다.
    expect((await apiRestaurant(await userClient(accounts.a), id))?.visited_date).toBe(visitDate);

    // A 후기
    await a.page.getByRole('radio', { name: /4점/ }).check({ force: true });
    await a.page.getByLabel('한 줄 후기').fill('A: 또 가고 싶다');
    await a.page.getByRole('button', { name: '내 후기 저장' }).click();
    await expect(a.page.getByText('내 후기를 저장했어요.')).toBeVisible();

    // B 후기 — A 후기는 읽기만 가능(편집 수단 없음)
    await gotoDetail(b.page, id);
    const partner = b.page.getByTestId('partner-review');
    await expect(partner).toContainText('A: 또 가고 싶다');
    await expect(partner.getByRole('button')).toHaveCount(0);
    await expect(partner.getByRole('textbox')).toHaveCount(0);
    await b.page.getByRole('radio', { name: /5점/ }).check({ force: true });
    await b.page.getByLabel('한 줄 후기').fill('B: 최고');
    await b.page.getByRole('button', { name: '내 후기 저장' }).click();
    await expect(b.page.getByText('내 후기를 저장했어요.')).toBeVisible();

    // A 후기 수정 → A가 본 B 후기는 그대로
    await gotoDetail(a.page, id);
    await expect(a.page.getByTestId('partner-review')).toContainText('B: 최고');
    await a.page.getByLabel('한 줄 후기').fill('A: 수정한 후기');
    await a.page.getByRole('button', { name: '내 후기 수정' }).click();
    await expect(a.page.getByText('내 후기를 저장했어요.')).toBeVisible();

    const apiA = await userClient(accounts.a);
    let reviews = await apiReviews(apiA, id);
    expect(reviews).toHaveLength(2);
    expect(reviews.find((review) => review.user_id === accounts.a.userId)?.comment).toBe('A: 수정한 후기');
    expect(reviews.find((review) => review.user_id === accounts.b.userId)?.comment).toBe('B: 최고');

    // A 후기 삭제(확인 대화상자)
    await a.page.getByRole('button', { name: '내 후기 삭제' }).click();
    await expect(a.page.getByRole('alertdialog')).toContainText('내 후기를 삭제할까요?');
    await a.page.getByRole('alertdialog').getByRole('button', { name: '내 후기 삭제' }).click();
    await expect(a.page.getByText('내 후기를 삭제했어요.')).toBeVisible();
    reviews = await apiReviews(apiA, id);
    expect(reviews.map((review) => review.user_id)).toEqual([accounts.b.userId]);

    // B가 맛집 삭제 — 함께 지워질 후기(B 후기 1개)를 보여 주고 확인을 받는다
    await gotoDetail(b.page, id);
    await b.page.getByRole('button', { name: '맛집 삭제' }).click();
    const dialog = b.page.getByRole('alertdialog');
    await expect(dialog).toContainText('후기 1개도 함께 삭제돼요');
    await expect(dialog).toContainText('B: 최고');
    await dialog.getByRole('button', { name: '취소' }).click();
    expect(await apiRestaurant(apiA, id)).not.toBeNull();

    await b.page.getByRole('button', { name: '맛집 삭제' }).click();
    await b.page.getByRole('alertdialog').getByRole('button', { name: '후기 1개와 함께 삭제' }).click();
    await expect(b.page.getByRole('heading', { name: '맛집', exact: true })).toBeVisible();

    expect(await apiRestaurant(apiA, id)).toBeNull();
    expect(await apiReviews(apiA, id)).toHaveLength(0);

    // 삭제된 주소는 404 화면
    await a.page.goto(`/restaurants/${id}`);
    await expect(a.page.getByRole('heading', { name: '이 맛집을 찾지 못했어요' })).toBeVisible();
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('입력 검증: 오류 필드로 포커스를 옮기고 저장하지 않는다', async ({ page }) => {
  await login(page, accounts.a);
  await page.goto('/restaurants/new');

  await page.getByRole('button', { name: '맛집 등록' }).click();
  await expect(page.getByLabel('이름')).toBeFocused();
  await expect(page.getByText('이름을(를) 입력해 주세요.').first()).toBeVisible();

  const name = uniqueName('검증');
  await page.getByLabel('이름').fill(name);
  await page.getByLabel('지도 링크').fill('http://map.naver.com/p/1');
  await page.getByRole('button', { name: '맛집 등록' }).click();
  await expect(page.getByLabel('지도 링크')).toBeFocused();
  await expect(page.getByText('https://로 시작하는 주소만').first()).toBeVisible();

  await page.getByLabel('지도 링크').fill('https://evil.example.com/p/1');
  await page.getByRole('button', { name: '맛집 등록' }).click();
  await expect(page.getByText('네이버 지도·카카오맵 공유 링크만').first()).toBeVisible();

  // 저장되지 않았다
  const api = await userClient(accounts.a);
  const { count } = await api.from('restaurants').select('id', { count: 'exact', head: true }).eq('name', name);
  expect(count).toBe(0);
});

test('미래 방문일은 화면에서 막고 서버에도 저장되지 않는다', async ({ page }) => {
  await login(page, accounts.a);
  const api = await userClient(accounts.a);
  const id = await apiCreateRestaurant(api, { name: uniqueName('미래') });

  await gotoDetail(page, id);
  // 1차 실행 실패 분석: 서버 렌더 직후(하이드레이션 전) 입력·클릭은 사라질 수 있었다.
  // 이제 방문 기록 입력은 하이드레이션 뒤에만 활성화되고, fill/click은 활성화를 기다린다.
  const visitDate = page.getByLabel('방문일');
  await expect(visitDate).toBeEnabled();
  await visitDate.fill('2999-01-01');
  // 입력값이 하이드레이션·마운트 처리로 덮어쓰이지 않았는지 먼저 본다.
  await expect(visitDate).toHaveValue('2999-01-01');
  await page.getByRole('button', { name: '다녀왔어요' }).click();
  await expect(page.getByText(FUTURE_VISIT_MESSAGE)).toBeVisible();
  await expect(visitDate).toBeFocused();

  const row = await apiRestaurant(api, id);
  expect(row?.status).toBe('wishlist');
  expect(row?.visited_date).toBeNull();
});

test('저장한 문자열은 일반 텍스트로만 그린다(스크립트·태그 해석 없음)', async ({ page }) => {
  const dialogs = failOnDialog(page);
  await login(page, accounts.a);
  const api = await userClient(accounts.a);
  const payload = `<img src=x onerror=alert(1)> ${RUN_TAG}`;
  const id = await apiCreateRestaurant(api, { name: payload, memo: '<script>alert(2)</script>' });

  await gotoDetail(page, id);
  await expect(page.getByRole('heading', { name: payload })).toBeVisible();
  await expect(page.getByText('<script>alert(2)</script>')).toBeVisible();
  await expect(page.locator('article img')).toHaveCount(0);
  expect(dialogs.triggered()).toBe(false);
});

test('목록: 이름 검색·지역·종류·상태 필터는 URL에 남고, 20개씩 중복 없이 더 본다', async ({ page }) => {
  const api = await userClient(accounts.a);
  const area = `P${RUN_TAG}`;
  const names: string[] = [];
  for (let index = 0; index < 23; index += 1) {
    const name = `F1 페이지 ${RUN_TAG} ${String(index).padStart(2, '0')}`;
    names.push(name);
    await apiCreateRestaurant(api, { name, area, category: index % 2 === 0 ? '짝' : '홀' });
  }
  // 하나는 방문 완료
  const visitedId = await apiCreateRestaurant(api, { name: `F1 방문 ${RUN_TAG}`, area, category: '짝' });
  await apiSetVisited(api, visitedId, 1, seoulDateDaysAgo(1));

  await login(page, accounts.b);
  await gotoRestaurants(page, `?area=${encodeURIComponent(area)}`);

  const list = page.getByTestId('restaurant-list').getByRole('link');
  await expect(list).toHaveCount(20);
  // 최신 등록 순: 방문 맛집 → 22 → 21 …
  await expect(list.first()).toContainText(`F1 방문 ${RUN_TAG}`);
  await expect(list.nth(1)).toContainText(names[22] ?? '');

  await page.getByRole('button', { name: '더 보기' }).click();
  await expect(list).toHaveCount(24);
  await expect(page.getByText('목록 끝이에요.')).toBeVisible();
  const texts = await list.allTextContents();
  const shown = names.filter((name) => texts.some((text) => text.includes(name)));
  expect(shown).toHaveLength(23);
  expect(new Set(texts).size).toBe(24);

  // 상태 탭: 다녀온 곳
  await page.getByRole('navigation', { name: '방문 상태' }).getByRole('link', { name: /다녀온 곳/ }).click();
  await expect(page).toHaveURL(/status=visited/);
  await expect(page).toHaveURL(new RegExp(`area=${area}`));
  await expect(list).toHaveCount(1);

  // 이름 검색 + 종류
  // 검색 구역 제목("이름·지역·종류로 찾기")도 '이름'을 포함하므로 검색 폼(role=search) 안의 입력을 정확한 이름으로 고른다.
  // 음식 종류 입력은 제안 목록(datalist)이 있으면 combobox 역할이라 정확 일치 라벨로 고른다.
  await gotoRestaurants(page, `?area=${encodeURIComponent(area)}`);
  const search = page.getByRole('search');
  const nameSearch = search.getByRole('searchbox', { name: '이름', exact: true });
  const categoryInput = search.getByLabel('음식 종류', { exact: true });
  await nameSearch.fill(`페이지 ${RUN_TAG} 0`);
  await categoryInput.fill('짝');
  await search.getByRole('button', { name: '찾기' }).click();
  await expect(page).toHaveURL(/category=/);
  // 00~09 중 짝수 인덱스: 00,02,04,06,08
  await expect(list).toHaveCount(5);

  // 뒤로 가기로 이전 필터 복원
  await page.goBack();
  await expect(list).toHaveCount(20);
  await expect(categoryInput).toHaveValue('');
  await expect(nameSearch).toHaveValue('');

  // 결과 없음은 빈 상태 안내(조회 실패와 구분)
  await gotoRestaurants(page, `?q=${encodeURIComponent(`없는이름-${RUN_TAG}`)}`);
  await expect(page.getByRole('heading', { name: '조건에 맞는 맛집이 없어요' })).toBeVisible();
});
