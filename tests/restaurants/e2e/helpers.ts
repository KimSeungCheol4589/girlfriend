import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { login as authLogin, waitForScreen } from '../../auth/e2e/helpers';

/**
 * FOOD-001 E2E 공용 도우미.
 *
 * 규칙
 *   - 계정은 `food001-*` 합성 계정만 쓴다(`.agent-runtime/food001-e2e/accounts.json`). AUTH·MEM 계정은 읽지 않는다.
 *   - 비밀번호·토큰·키를 단언 값·로그에 넣지 않는다.
 *   - 직접 API 호출은 **공개 키 + 사용자 세션**으로만 한다(앱과 같은 권한). 관리자 키는 쓰지 않는다.
 *   - 화면 판정은 렌더된 내용으로 한다(서버 리다이렉트는 스트리밍으로 온다. tests/auth/README.md 6).
 */

export type FoodAccount = { email: string; password: string; userId: string | null };
export type FoodAccounts = Record<'a' | 'b' | 'c', FoodAccount>;

const ACCOUNTS_PATH = resolve(__dirname, '..', '..', '..', '.agent-runtime', 'food001-e2e', 'accounts.json');

export function loadFoodAccounts(): FoodAccounts {
  let raw: string;
  try {
    raw = readFileSync(ACCOUNTS_PATH, 'utf8');
  } catch {
    throw new Error('food001 합성 계정 정보가 없습니다. 먼저 `node tests/restaurants/fixtures/cli.mjs setup`을 실행하세요.');
  }
  const accounts = (JSON.parse(raw) as { accounts?: Partial<FoodAccounts> }).accounts;
  for (const key of ['a', 'b', 'c'] as const) {
    const account = accounts?.[key];
    if (!account || !account.email.startsWith('food001-') || !account.email.endsWith('@test.invalid')) {
      throw new Error(`food001 합성 계정(${key})이 없거나 형식이 다릅니다. 픽스처 setup을 다시 실행하세요.`);
    }
  }
  return accounts as FoodAccounts;
}

/** 이번 실행을 구분하는 짧은 태그. 이름·지역에 붙여 다른 실행·다른 테스트와 섞이지 않게 한다. */
export const RUN_TAG = Date.now().toString(36).slice(-6);

export function uniqueName(label: string): string {
  return `F1 ${label} ${RUN_TAG}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// 화면
// ---------------------------------------------------------------------------

export async function login(page: Page, account: FoodAccount): Promise<void> {
  await authLogin(page, account);
}

/** 새 브라우저 컨텍스트에서 로그인한 페이지. 두 사람을 동시에 흉내 낼 때 쓴다. */
export async function openAs(browser: Browser, account: FoodAccount): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, account);
  return { context, page };
}

export async function gotoRestaurants(page: Page, query = ''): Promise<void> {
  await page.goto(`/restaurants${query}`);
  await expect(page.getByRole('heading', { name: '맛집', exact: true })).toBeVisible();
}

export async function gotoDetail(page: Page, id: string): Promise<void> {
  await page.goto(`/restaurants/${id}`);
  await expect(page.getByRole('heading', { name: '방문 기록' })).toBeVisible();
}

export function restaurantIdFromUrl(page: Page): string {
  const match = /\/restaurants\/([0-9a-f-]{36})(?:$|[/?#])/.exec(new URL(page.url()).pathname + '#');
  if (!match?.[1]) throw new Error('맛집 상세 주소가 아닙니다.');
  return match[1];
}

export type RestaurantFormInput = {
  name: string;
  area?: string;
  category?: string;
  mapUrl?: string;
  memo?: string;
};

export async function fillRestaurantForm(page: Page, input: RestaurantFormInput): Promise<void> {
  await page.getByLabel('이름').fill(input.name);
  await page.getByLabel('지역').fill(input.area ?? '');
  await page.getByLabel('음식 종류').fill(input.category ?? '');
  await page.getByLabel('지도 링크').fill(input.mapUrl ?? '');
  await page.getByLabel('메모').fill(input.memo ?? '');
}

/** UI로 맛집을 만들고 상세 화면의 ID를 돌려준다. */
export async function createRestaurantViaUi(page: Page, input: RestaurantFormInput): Promise<string> {
  await page.goto('/restaurants/new');
  await expect(page.getByRole('heading', { name: '맛집 추가' })).toBeVisible();
  await fillRestaurantForm(page, input);
  await page.getByRole('button', { name: '맛집 등록' }).click();
  await expect(page.getByRole('heading', { name: input.name })).toBeVisible();
  return restaurantIdFromUrl(page);
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
export async function userClient(account: FoodAccount): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
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

export async function apiCreateRestaurant(
  client: SupabaseClient,
  input: { name: string; area?: string; category?: string; mapUrl?: string | null; memo?: string },
  requestId: string = newRequestId(),
): Promise<string> {
  const result = await callRpc(client, 'save_restaurant', {
    p_restaurant_id: null,
    p_name: input.name,
    p_area: input.area ?? '',
    p_category: input.category ?? '',
    p_map_url: input.mapUrl ?? null,
    p_memo: input.memo ?? '',
    p_expected_version: 0,
    p_request_id: requestId,
  });
  if (!result.ok) throw new Error(`save_restaurant 실패 code=${result.code}`);
  return String(result.data.restaurantId);
}

export async function apiSetVisited(client: SupabaseClient, id: string, version: number, date: string): Promise<number> {
  const result = await callRpc(client, 'set_restaurant_status', {
    p_restaurant_id: id,
    p_status: 'visited',
    p_visited_date: date,
    p_confirm_delete_reviews: false,
    p_expected_version: version,
    p_request_id: newRequestId(),
  });
  if (!result.ok) throw new Error(`set_restaurant_status 실패 code=${result.code}`);
  return Number(result.data.version);
}

export async function apiRestaurant(
  client: SupabaseClient,
  id: string,
): Promise<{ id: string; name: string; memo: string; status: string; visited_date: string | null; version: number } | null> {
  const { data, error } = await client
    .from('restaurants')
    .select('id, name, memo, status, visited_date, version')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`restaurants 조회 실패 code=${error.code}`);
  return data;
}

export async function apiReviews(
  client: SupabaseClient,
  restaurantId: string,
): Promise<{ id: string; user_id: string; rating: number; comment: string; version: number }[]> {
  const { data, error } = await client
    .from('restaurant_reviews')
    .select('id, user_id, rating, comment, version')
    .eq('restaurant_id', restaurantId);
  if (error) throw new Error(`restaurant_reviews 조회 실패 code=${error.code}`);
  return data ?? [];
}

export async function apiCountByName(client: SupabaseClient, name: string): Promise<number> {
  const { count, error } = await client
    .from('restaurants')
    .select('id', { count: 'exact', head: true })
    .eq('name', name);
  if (error) throw new Error(`restaurants 개수 조회 실패 code=${error.code}`);
  return count ?? 0;
}

/** 한국 날짜 기준 N일 전 `YYYY-MM-DD`. */
export function seoulDateDaysAgo(days: number): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(Date.now() - days * 86_400_000));
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
