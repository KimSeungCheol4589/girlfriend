import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  createInviteLink,
  ensureSpace,
  expireInvitesFor,
  loadAccounts,
  login,
  openSettings,
  pathnameOf,
  submitInviteForm,
  toRelative,
  waitForScreen,
  type Account,
} from './helpers';

/**
 * 초대 발급·수락·재사용·만료·대상 불일치·정원.
 *
 * 전제: 픽스처 `setup`이 합성 계정 A~D를 만들었고 A만 공간을 만들 수 있다.
 * 공간이 없으면 이 파일이 직접 만든다(스펙 파일 실행 순서에 기대지 않는다).
 * 토큰은 fragment로만 전달되고 주소에서 곧바로 지워지는지도 함께 확인한다.
 */

const accounts = loadAccounts();

test.describe.configure({ mode: 'serial' });

async function signedInPage(context: BrowserContext, account: Account): Promise<Page> {
  const page = await context.newPage();
  await login(page, account);
  return page;
}

/** 공간 주인(A) 화면. 스펙 실행 순서에 기대지 않도록 공간이 없으면 만든다. */
async function ownerPage(context: BrowserContext): Promise<Page> {
  const page = await signedInPage(context, accounts.a);
  await ensureSpace(page);
  return page;
}

/**
 * 초대 화면을 열고 수락 버튼이 있으면 누른다.
 * 토큰을 확인하는 동안에는 버튼도 안내도 없으므로 둘 중 하나가 나타날 때까지 기다린다.
 */
async function openInviteAndAccept(page: Page, link: string): Promise<void> {
  await page.goto(toRelative(link));
  await waitForScreen(page, ['invite', 'home']);

  const accept = page.getByRole('button', { name: '초대 수락하기' });
  const problem = page.getByText(
    /초대 링크를 확인하지 못했어요|사용할 수 없는 초대 링크|초대 링크가 만료됐습니다/,
  );
  await expect(accept.or(problem).first()).toBeVisible();

  if (await accept.isVisible()) await accept.click();
}

test('같은 주소로 초대를 다시 만들 수 있다 (화면을 다시 불러오지 않고)', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerPage(ownerContext);

  const first = await createInviteLink(owner, accounts.b.email);

  // 같은 화면에서 같은 주소로 한 번 더. 이전에는 멱등 재생 때문에 여기서 막혔다.
  const second = await submitInviteForm(owner, accounts.b.email);
  expect(second !== first, '같은 주소로 새 초대가 만들어져야 한다').toBe(true);
  await expect(owner.getByText(/이미 처리됐습니다/)).toHaveCount(0);

  // 폐기 → 다시 만들기도 화면을 다시 불러오지 않고 된다.
  // (폐기 성공 문구는 목록이 갱신되며 사라질 수 있으므로 서버가 그린 상태를 확인한다.)
  await owner.getByRole('button', { name: '폐기하기' }).first().click();
  await expect(owner.getByText('폐기됨').first()).toBeVisible();

  const third = await submitInviteForm(owner, accounts.b.email);
  expect(third !== second, '폐기 후에도 새 초대가 만들어져야 한다').toBe(true);

  await ownerContext.close();
});

test('만료된 초대는 새 링크를 요청하라고 안내한다', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerPage(ownerContext);
  const link = await createInviteLink(owner, accounts.b.email);

  const expired = expireInvitesFor(accounts.b.email);
  test.skip(!expired, 'AUTH_TEST_DB_CONTAINER가 없어 만료 시나리오를 실행할 수 없습니다.');

  const guestContext = await browser.newContext();
  const guest = await signedInPage(guestContext, accounts.b);
  await openInviteAndAccept(guest, link);

  await expect(guest.getByText(/초대 링크가 만료됐습니다/)).toBeVisible();
  // 만료된 초대로는 공간에 들어가지 못한다.
  await guest.goto('/');
  await waitForScreen(guest, ['onboarding']);

  await ownerContext.close();
  await guestContext.close();
});

test('대상이 아닌 계정은 초대를 수락할 수 없다', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerPage(ownerContext);
  const link = await createInviteLink(owner, accounts.b.email);

  const outsiderContext = await browser.newContext();
  const outsider = await signedInPage(outsiderContext, accounts.c);
  await openInviteAndAccept(outsider, link);

  await expect(outsider.getByText(/사용할 수 없는 초대 링크/)).toBeVisible();
  // 외부 계정은 여전히 공간이 없다.
  await outsider.goto('/');
  await waitForScreen(outsider, ['onboarding']);

  await ownerContext.close();
  await outsiderContext.close();
});

test('대상 계정이 초대를 수락하면 두 사람이 같은 공간을 쓴다', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerPage(ownerContext);
  const link = await createInviteLink(owner, accounts.b.email);

  const guestContext = await browser.newContext();
  const guest = await signedInPage(guestContext, accounts.b);

  await guest.goto(toRelative(link));
  await waitForScreen(guest, ['invite']);

  // 토큰은 주소에서 곧바로 사라져야 한다. 값이 아니라 "비어 있음"만 단언한다.
  await expect.poll(() => new URL(guest.url()).hash).toBe('');

  await guest.getByRole('button', { name: '초대 수락하기' }).click();
  await waitForScreen(guest, ['home']);
  expect(pathnameOf(guest)).toBe('/');

  // 수락 뒤에는 보관한 토큰도 남지 않는다(값이 아니라 존재 여부만 본다).
  const hasStoredToken = await guest.evaluate(
    () => window.sessionStorage.getItem('gf.invite.token') !== null,
  );
  expect(hasStoredToken).toBe(false);

  // 초대한 사람 화면에도 수락 상태가 보인다.
  await openSettings(owner);
  await expect(owner.getByText('수락됨')).toBeVisible();

  // 같은 사용자가 같은 링크를 다시 열면 계약대로 멱등 성공이고(CONTRACTS.md 1) 구성원이 늘지 않는다.
  await openInviteAndAccept(guest, link);
  await waitForScreen(guest, ['home', 'invite']);
  await expect(guest.getByText(/사용할 수 없는 초대 링크/)).toHaveCount(0);

  // 다른 계정이 이미 사용된 링크를 재사용하면 거부된다.
  const outsiderContext = await browser.newContext();
  const outsider = await signedInPage(outsiderContext, accounts.c);
  await openInviteAndAccept(outsider, link);
  await expect(outsider.getByText(/사용할 수 없는 초대 링크/)).toBeVisible();
  await outsider.goto('/');
  await waitForScreen(outsider, ['onboarding']);
  await outsiderContext.close();

  await ownerContext.close();
  await guestContext.close();
});

test('정원이 차면 새 초대를 만들 수 없다', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerPage(ownerContext);
  await openSettings(owner);

  await expect(owner.getByText('이미 두 사람이 참여해 정원이 찼습니다')).toBeVisible();
  await expect(owner.getByRole('button', { name: '초대 링크 만들기' })).toHaveCount(0);

  await ownerContext.close();
});

test('초대 토큰이 없으면 새 초대를 요청하라고 안내한다', async ({ browser }) => {
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto('/invite');
  await waitForScreen(guest, ['invite']);

  await expect(guest.getByText('초대 링크를 확인하지 못했어요')).toBeVisible();
  await expect(guest.getByText(/새 초대 링크/)).toBeVisible();

  await guestContext.close();
});

test('설정은 본인 프로필만 바꾸고 상대방 닉네임은 그대로다', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const owner = await ownerPage(ownerContext);
  const guest = await signedInPage(guestContext, accounts.b);

  await openSettings(owner);
  await owner.getByLabel('닉네임').fill('민서');
  await owner.getByRole('button', { name: '닉네임 저장' }).click();
  await expect(owner.getByText('닉네임을 저장했습니다.')).toBeVisible();

  await openSettings(guest);
  await expect(guest.getByLabel('닉네임')).not.toHaveValue('민서');
  // 상대방 닉네임은 구성원 목록에서 볼 수 있다.
  await expect(guest.getByText('민서').first()).toBeVisible();

  await ownerContext.close();
  await guestContext.close();
});
