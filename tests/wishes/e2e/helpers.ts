import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { login as authLogin, logout as authLogout, waitForScreen } from '../../auth/e2e/helpers';

/**
 * WISH-001 E2E 공용 도우미.
 *
 * 규칙
 *   - 계정은 `wish-e2e-*` 합성 계정만 쓴다(`.agent-runtime/wish-e2e/accounts.json`).
 *     AUTH·MEM·FOOD 계정은 읽지 않는다.
 *   - 비밀번호·토큰·키를 단언 값·로그에 넣지 않는다.
 *   - 직접 API 호출은 **공개 키 + 사용자 세션**으로만 한다(앱과 같은 권한). 관리자 키는 쓰지 않는다.
 *   - 화면 판정은 렌더된 내용으로 한다(서버 리다이렉트는 스트리밍으로 온다. tests/auth/README.md 6).
 */

export type WishAccount = { email: string; password: string; userId: string | null };
export type WishAccounts = Record<'a' | 'b' | 'c', WishAccount>;

const ACCOUNTS_PATH = resolve(__dirname, '..', '..', '..', '.agent-runtime', 'wish-e2e', 'accounts.json');

export function loadWishAccounts(): WishAccounts {
  let raw: string;
  try {
    raw = readFileSync(ACCOUNTS_PATH, 'utf8');
  } catch {
    throw new Error(
      'wish-e2e 합성 계정 정보가 없습니다. 먼저 `node tests/wishes/fixtures/cli.mjs setup`을 실행하세요.',
    );
  }
  const accounts = (JSON.parse(raw) as { accounts?: Partial<WishAccounts> }).accounts;
  for (const key of ['a', 'b', 'c'] as const) {
    const account = accounts?.[key];
    if (!account || !account.email.startsWith('wish-e2e-') || !account.email.endsWith('@test.invalid')) {
      throw new Error(`wish-e2e 합성 계정(${key})이 없거나 형식이 다릅니다. 픽스처 setup을 다시 실행하세요.`);
    }
  }
  return accounts as WishAccounts;
}

/** 이번 실행을 구분하는 짧은 태그. 제목에 붙여 다른 실행·다른 테스트와 섞이지 않게 한다. */
export const RUN_TAG = Date.now().toString(36).slice(-6);

export function uniqueTitle(label: string): string {
  return `W1 ${label} ${RUN_TAG}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// 화면
// ---------------------------------------------------------------------------

export async function login(page: Page, account: WishAccount): Promise<void> {
  await authLogin(page, account);
}

export async function logout(page: Page): Promise<void> {
  await authLogout(page);
}

/** 새 브라우저 컨텍스트에서 로그인한 페이지. 두 사람을 동시에 흉내 낼 때 쓴다. */
export async function openAs(
  browser: Browser,
  account: WishAccount,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, account);
  return { context, page };
}

export async function gotoWishes(page: Page, query = ''): Promise<void> {
  await page.goto(`/wishes${query}`);
  await expect(page.getByRole('heading', { name: '하고 싶은 일', exact: true })).toBeVisible();
  // 검색 폼이 하이드레이션되기 전에 입력하면 그 값이 URL 값으로 되돌아간다(제어 입력).
  // 실제 사용자가 화면이 준비된 뒤에 입력하는 상황을 그대로 재현한다.
  await expect(page.locator('form[role="search"][data-hydrated="true"]')).toBeVisible();
}

/** 목록으로 이동한 뒤 검색 폼이 입력을 기억할 준비가 될 때까지 기다린다. */
export async function waitSearchReady(page: Page): Promise<void> {
  await expect(page.locator('form[role="search"][data-hydrated="true"]')).toBeVisible();
}

/** 검색 영역의 접근 가능한 이름에도 ‘제목’·‘분류’가 들어 있어 역할로 좁힌다. */
export function searchTitleBox(page: Page) {
  return page.getByRole('searchbox', { name: '제목' });
}

export function searchCategorySelect(page: Page) {
  return page.getByRole('combobox', { name: '분류' });
}

export async function gotoDetail(page: Page, id: string): Promise<void> {
  await page.goto(`/wishes/${id}`);
  await expect(page.getByRole('heading', { name: '계획과 상태' })).toBeVisible();
}

export function wishIdFromUrl(page: Page): string {
  const match = /\/wishes\/([0-9a-f-]{36})(?:$|[/?#])/.exec(new URL(page.url()).pathname + '#');
  if (!match?.[1]) throw new Error('위시 상세 주소가 아닙니다.');
  return match[1];
}

export type WishFormInput = {
  title: string;
  category?: string;
  linkUrl?: string;
  memo?: string;
};

export async function fillWishForm(page: Page, input: WishFormInput): Promise<void> {
  await page.getByLabel('제목').fill(input.title);
  if (input.category) await page.getByLabel('분류').selectOption(input.category);
  await page.getByLabel('링크').fill(input.linkUrl ?? '');
  await page.getByLabel('메모').fill(input.memo ?? '');
}

/** UI로 위시를 만들고 상세 화면의 ID를 돌려준다. */
export async function createWishViaUi(page: Page, input: WishFormInput): Promise<string> {
  await page.goto('/wishes/new');
  await expect(page.getByRole('heading', { name: '위시 추가' })).toBeVisible();
  await fillWishForm(page, input);
  await page.getByRole('button', { name: '위시 등록' }).click();
  await expect(page.getByRole('heading', { name: input.title })).toBeVisible();
  return wishIdFromUrl(page);
}

export { waitForScreen };

// ---------------------------------------------------------------------------
// 직접 API (공개 키 + 사용자 세션) — 앱을 거치지 않는 우회 시도와 경쟁 재현에 쓴다
// ---------------------------------------------------------------------------

function readPublicConfig(): { url: string; anonKey: string } {
  const url = (process.env.AUTH_TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (
    process.env.AUTH_TEST_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ''
  ).trim();
  if (url === '' || anonKey === '') throw new Error('로컬 Supabase 주소·공개 키가 필요합니다.');
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
    throw new Error('로컬(loopback) Supabase에서만 실행합니다.');
  }
  return { url, anonKey };
}

function newClient(): SupabaseClient {
  const { url, anonKey } = readPublicConfig();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** 비로그인 클라이언트. */
export function anonClient(): SupabaseClient {
  return newClient();
}

/** 사용자 세션 클라이언트. 로그인 실패 시 이메일·비밀번호를 메시지에 넣지 않는다. */
export async function userClient(account: WishAccount): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (error) throw new Error(`API 로그인 실패(status=${error.status ?? 'unknown'})`);
  return client;
}

export type RpcOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; code: string; details: string };

/** RPC 결과를 SQLSTATE·DETAIL(필드 힌트 JSON)로만 요약한다. 메시지 원문은 버린다. */
export async function callRpc(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcOutcome> {
  const { data, error } = await client.rpc(fn, args);
  if (error) return { ok: false, code: error.code ?? '', details: error.details ?? '' };
  return { ok: true, data: (data ?? {}) as Record<string, unknown> };
}

export function newRequestId(): string {
  return randomUUID();
}

export async function apiCreateWish(
  client: SupabaseClient,
  input: { title: string; category?: string; memo?: string; linkUrl?: string | null },
  requestId: string = newRequestId(),
): Promise<string> {
  const result = await callRpc(client, 'save_wish', {
    p_wish_id: null,
    p_title: input.title,
    p_category: input.category ?? 'other',
    p_memo: input.memo ?? '',
    p_link_url: input.linkUrl ?? null,
    p_expected_version: 0,
    p_request_id: requestId,
  });
  if (!result.ok) throw new Error(`save_wish 실패 code=${result.code}`);
  return String(result.data.wishId);
}

export async function apiSetStatus(
  client: SupabaseClient,
  id: string,
  status: string,
  plannedDate: string | null,
  version: number,
): Promise<number> {
  const result = await callRpc(client, 'set_wish_status', {
    p_wish_id: id,
    p_status: status,
    p_planned_date: plannedDate,
    p_expected_version: version,
    p_request_id: newRequestId(),
  });
  if (!result.ok) throw new Error(`set_wish_status 실패 code=${result.code}`);
  return Number(result.data.version);
}

export async function apiWish(
  client: SupabaseClient,
  id: string,
): Promise<{
  id: string;
  title: string;
  category: string;
  memo: string;
  link_url: string | null;
  status: string;
  planned_date: string | null;
  version: number;
} | null> {
  const { data, error } = await client
    .from('wish_items')
    .select('id, title, category, memo, link_url, status, planned_date, version')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`wish_items 조회 실패 code=${error.code}`);
  return data;
}

export async function apiCountByTitle(client: SupabaseClient, title: string): Promise<number> {
  const { count, error } = await client
    .from('wish_items')
    .select('id', { count: 'exact', head: true })
    .eq('title', title);
  if (error) throw new Error(`wish_items 개수 조회 실패 code=${error.code}`);
  return count ?? 0;
}

/**
 * `YYYY-MM-DD`를 화면 표기(`2026년 11월 7일`)로 바꾼다.
 *
 * 저장 결과 안내 문구에 저장된 날짜가 들어가므로, 이 문구를 기다리면
 * "방금 누른 저장이 끝났다"를 정확히 알 수 있다(앞선 저장의 문구와 구분된다).
 */
export function koreanDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

/** 한국 날짜 기준 N일 뒤 `YYYY-MM-DD`. 음수면 과거다. */
export function seoulDateInDays(days: number): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(Date.now() + days * 86_400_000));
}

/** 브라우저 대화상자(alert 등)가 뜨면 실패로 기록한다. 저장된 문자열이 스크립트로 실행되지 않는지 확인한다. */
export function failOnDialog(page: Page): { triggered: () => boolean } {
  let triggered = false;
  page.on('dialog', (dialog) => {
    triggered = true;
    void dialog.dismiss();
  });
  return { triggered: () => triggered };
}
