import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, type BrowserContext, type Cookie, type Page } from '@playwright/test';

/**
 * 인증 E2E 공용 도우미.
 *
 * 규칙
 *   - 합성 계정 정보는 Git 제외 경로(`.agent-runtime/auth-e2e/accounts.json`)에서 읽는다.
 *   - **비밀번호·토큰·키를 단언 값이나 로그에 넣지 않는다.** 비교가 필요하면 boolean으로 바꾼다.
 *   - 화면 판정은 URL이 아니라 **렌더된 내용**으로 한다. 서버 컴포넌트의 `redirect()`는
 *     스트리밍으로 전달될 수 있어 `page.goto()` 직후의 주소가 최종 주소가 아니다
 *     (AUTH-001 1차 E2E 실패의 실제 원인).
 */

export type Account = { email: string; password: string; userId: string | null };
export type AccountKey = 'a' | 'b' | 'c' | 'd';
export type Accounts = Record<AccountKey, Account>;

const ACCOUNTS_PATH = join(process.cwd(), '.agent-runtime', 'auth-e2e', 'accounts.json');

export function loadAccounts(): Accounts {
  let raw: string;
  try {
    raw = readFileSync(ACCOUNTS_PATH, 'utf8');
  } catch {
    throw new Error(
      '합성 계정 정보가 없습니다. 먼저 `node tests/auth/fixtures/cli.mjs setup`을 실행하세요.',
    );
  }

  const parsed = JSON.parse(raw) as { accounts?: Partial<Accounts> };
  const accounts = parsed.accounts;
  const missing = (['a', 'b', 'c', 'd'] as const).filter((key) => !accounts?.[key]);
  if (!accounts || missing.length > 0) {
    throw new Error(
      `합성 계정(${missing.join(', ')})이 없습니다. 픽스처 setup을 다시 실행하세요.`,
    );
  }
  return accounts as Accounts;
}

// ---------------------------------------------------------------------------
// 화면 판정 — 스트리밍 리다이렉트가 끝난 뒤의 실제 화면을 기다린다
// ---------------------------------------------------------------------------

export type ScreenName =
  | 'home'
  | 'onboarding'
  | 'login'
  | 'settings'
  | 'invite'
  | 'pending'
  | 'resetRequest'
  | 'newPassword'
  | 'setupRequired';

const SCREEN_MARKERS: Record<ScreenName, (page: Page) => ReturnType<Page['getByRole']>> = {
  home: (page) => page.getByRole('heading', { name: '우리 공간 구성원' }),
  onboarding: (page) => page.getByRole('heading', { name: '우리 공간 만들기' }),
  login: (page) => page.getByRole('heading', { name: '로그인', exact: true }),
  settings: (page) => page.getByRole('heading', { name: '설정', exact: true }),
  invite: (page) => page.getByRole('heading', { name: '초대 수락', exact: true }),
  pending: (page) => page.getByRole('heading', { name: '추억', exact: true }),
  resetRequest: (page) => page.getByRole('heading', { name: '비밀번호 재설정', exact: true }),
  newPassword: (page) => page.getByRole('heading', { name: '새 비밀번호 설정', exact: true }),
  setupRequired: (page) => page.getByRole('heading', { name: '설정이 필요합니다', exact: true }),
};

/**
 * 주어진 화면 중 하나가 실제로 그려질 때까지 기다리고, 어떤 화면인지 돌려준다.
 *
 * `page.goto()`가 돌아온 시점의 주소를 믿지 않는다. Next.js의 서버 리다이렉트는
 * 스트리밍으로 전달되어 주소가 나중에 바뀔 수 있다.
 */
export async function waitForScreen<T extends ScreenName>(
  page: Page,
  names: readonly T[],
  timeout = 15_000,
): Promise<T> {
  const markers = names.map((name) => SCREEN_MARKERS[name](page).first());
  const combined = markers.reduce((left, right) => left.or(right));

  await expect(combined.first()).toBeVisible({ timeout });

  for (const [index, marker] of markers.entries()) {
    if (await marker.isVisible()) {
      const name = names[index];
      if (name) return name;
    }
  }
  throw new Error(`화면을 판별하지 못했습니다: ${names.join(', ')}`);
}

/** 화면이 그려진 뒤의 경로만 확인한다(토큰이 들어 있는 주소를 단언 값으로 쓰지 않기 위해). */
export function pathnameOf(page: Page): string {
  return new URL(page.url()).pathname;
}

/** 로그인. 로그인 화면을 벗어난 뒤 최종 화면이 그려질 때까지 기다린다. */
export async function login(page: Page, account: Account, next?: string): Promise<void> {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await waitForScreen(page, ['login']);

  await page.getByLabel('이메일').fill(account.email);
  await page.getByLabel('비밀번호').fill(account.password);
  await page.getByRole('button', { name: '로그인' }).click();

  // 로그인 성공 후의 화면은 공간 소속에 따라 홈 또는 온보딩이다.
  await waitForScreen(page, ['home', 'onboarding', 'settings', 'invite', 'pending']);
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: '로그아웃' }).first().click();
  await waitForScreen(page, ['login']);
}

/**
 * A 계정의 공간이 없으면 만든다.
 *
 * 스펙 파일 사이의 실행 순서에 기대지 않기 위해 각 파일이 직접 호출한다.
 */
export async function ensureSpace(page: Page, name = '둘이 쌓는 공간'): Promise<void> {
  await page.goto('/');
  const screen = await waitForScreen(page, ['home', 'onboarding']);
  if (screen === 'home') return;

  await page.getByLabel('공간 이름').fill(name);
  await page.getByRole('button', { name: '공간 만들기' }).click();
  await waitForScreen(page, ['home']);
}

export async function openSettings(page: Page): Promise<void> {
  await page.goto('/settings');
  await waitForScreen(page, ['settings']);
}

/**
 * 이미 열려 있는 설정 화면에서 초대 폼을 제출하고 새 링크를 돌려준다.
 * 화면을 다시 불러오지 않으므로 "같은 화면에서 다시 만들기"를 확인할 수 있다.
 * 링크 값은 단언·로그에 쓰지 않는다(비교는 boolean으로).
 */
export async function submitInviteForm(page: Page, targetEmail: string): Promise<string> {
  const linkInput = page.getByLabel('초대 링크');
  const previous = (await linkInput.count()) > 0 ? await linkInput.inputValue() : null;

  await page.getByLabel('상대방 이메일').fill(targetEmail);
  await page.getByRole('button', { name: '초대 링크 만들기' }).click();

  await expect(linkInput).toBeVisible();
  // 이전 링크가 그대로 남아 있는 상태를 읽지 않도록 값이 바뀔 때까지 기다린다.
  if (previous !== null) {
    await expect
      .poll(async () => (await linkInput.inputValue()) !== previous, {
        message: '새 초대 링크가 만들어지지 않았습니다',
      })
      .toBe(true);
  }

  const link = await linkInput.inputValue();
  // 토큰이 실패 메시지로 새지 않도록 링크 원문 대신 boolean만 단언한다.
  expect(link.includes('/invite#token='), '초대 링크 형식이 올바르지 않습니다').toBe(true);
  return link;
}

/** 설정 화면을 열고 초대 링크를 만든다. */
export async function createInviteLink(page: Page, targetEmail: string): Promise<string> {
  await openSettings(page);
  return submitInviteForm(page, targetEmail);
}

/** 절대 주소에서 경로+fragment만 떼어 낸다(테스트 서버 주소가 달라도 동작하도록). */
export function toRelative(link: string): string {
  const url = new URL(link);
  return `${url.pathname}${url.search}${url.hash}`;
}

// ---------------------------------------------------------------------------
// 로컬 DB 보조 (이미 떠 있는 컨테이너에서 psql만 실행한다)
// ---------------------------------------------------------------------------

function runLocalSql(sql: string): boolean {
  const container = (process.env.AUTH_TEST_DB_CONTAINER ?? '').trim();
  if (container === '' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(container)) return false;

  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-f',
      '-',
    ],
    { input: sql, encoding: 'utf8' },
  );
  return result.status === 0;
}

/** 만료 시나리오용. 대상 이메일의 활성 초대를 과거로 옮긴다. */
export function expireInvitesFor(targetEmail: string): boolean {
  if (!targetEmail.endsWith('.invalid')) {
    throw new Error('합성 계정(.invalid) 대상만 만료 처리할 수 있습니다.');
  }
  return runLocalSql(
    `update public.space_invites
        set expires_at = now() - interval '1 hour'
      where target_email = '${targetEmail.replace(/'/g, "''")}'
        and accepted_at is null
        and revoked_at is null;`,
  );
}

// ---------------------------------------------------------------------------
// 세션 쿠키 도우미 — 토큰 값을 절대 출력하지 않는다
// ---------------------------------------------------------------------------

const BASE64_PREFIX = 'base64-';
/** @supabase/ssr의 MAX_CHUNK_SIZE와 같은 값. */
const MAX_CHUNK_SIZE = 3180;

export type StoredSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  [key: string]: unknown;
};

export type SessionCookieSet = {
  /** 청크 이름을 뺀 기본 쿠키 이름(`sb-<ref>-auth-token`). */
  key: string;
  cookies: Cookie[];
  session: StoredSession;
  /** 원본 쿠키 값이 퍼센트 인코딩돼 있었는지. 다시 쓸 때 같은 형식을 유지한다. */
  encoded: boolean;
  /** 원본이 `base64-` 형식이었는지. 다시 쓸 때 같은 형식을 유지한다. */
  base64: boolean;
};

function authCookieKey(cookies: Cookie[]): string | null {
  for (const cookie of cookies) {
    const match = /^(sb-.*-auth-token)(\.\d+)?$/.exec(cookie.name);
    if (match?.[1]) return match[1];
  }
  return null;
}

function chunkIndex(name: string, key: string): number {
  if (name === key) return 0;
  const suffix = name.slice(key.length + 1);
  const parsed = Number.parseInt(suffix, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decodeSessionValue(raw: string): StoredSession {
  const value = raw.startsWith(BASE64_PREFIX) ? raw.slice(BASE64_PREFIX.length) : raw;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const json = raw.startsWith(BASE64_PREFIX)
    ? Buffer.from(normalized, 'base64').toString('utf8')
    : value;
  return JSON.parse(json) as StoredSession;
}

function encodeSessionValue(session: StoredSession, wasBase64: boolean): string {
  const json = JSON.stringify(session);
  if (!wasBase64) return json;
  const base64url = Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${BASE64_PREFIX}${base64url}`;
}

/** @supabase/ssr의 createChunks와 같은 규칙(인코딩 길이 기준)으로 나눈다. */
function createChunks(key: string, value: string): { name: string; value: string }[] {
  let encoded = encodeURIComponent(value);
  if (encoded.length <= MAX_CHUNK_SIZE) return [{ name: key, value }];

  const parts: string[] = [];
  while (encoded.length > 0) {
    let head = encoded.slice(0, MAX_CHUNK_SIZE);
    const lastEscape = head.lastIndexOf('%');
    if (lastEscape > MAX_CHUNK_SIZE - 3) head = head.slice(0, lastEscape);
    parts.push(decodeURIComponent(head));
    encoded = encoded.slice(head.length);
  }
  return parts.map((part, index) => ({ name: `${key}.${index}`, value: part }));
}

/** 현재 컨텍스트의 세션 쿠키를 읽어 합친다. 값은 돌려주되 출력하지 않는다. */
export async function readSessionCookies(context: BrowserContext): Promise<SessionCookieSet | null> {
  const cookies = await context.cookies();
  const key = authCookieKey(cookies);
  if (!key) return null;

  const parts = cookies
    .filter((cookie) => cookie.name === key || cookie.name.startsWith(`${key}.`))
    .sort((left, right) => chunkIndex(left.name, key) - chunkIndex(right.name, key));
  if (parts.length === 0) return null;

  const encoded = parts.some((cookie) => cookie.value.includes('%'));
  const raw = parts
    .map((cookie) => (encoded ? decodeURIComponent(cookie.value) : cookie.value))
    .join('');

  return {
    key,
    cookies: parts,
    session: decodeSessionValue(raw),
    encoded,
    base64: raw.startsWith(BASE64_PREFIX),
  };
}

/**
 * 저장된 세션 메타데이터만 바꿔 **클라이언트가 만료로 판단**하게 만든다.
 *
 * refresh token은 그대로 두므로 서버는 유효한 refresh token으로 갱신을 시도한다.
 * 서버 벽시계로 실제 만료시키는 것이 아니라 **저장된 만료 시각을 과거로 바꾸는 모의**다.
 */
export async function forceStoredSessionExpiry(
  context: BrowserContext,
  set: SessionCookieSet,
): Promise<void> {
  const expiredAt = Math.floor(Date.now() / 1000) - 3600;
  const session: StoredSession = { ...set.session, expires_at: expiredAt, expires_in: 0 };
  const value = encodeSessionValue(session, set.base64);
  const chunks = createChunks(set.key, value);

  const template = set.cookies[0];
  if (!template) throw new Error('세션 쿠키를 찾지 못했습니다.');

  // 청크 수가 줄어들 수 있으므로 기존 쿠키를 모두 지운 뒤 다시 쓴다.
  for (const cookie of set.cookies) {
    await context.clearCookies({ name: cookie.name });
  }

  await context.addCookies(
    chunks.map((chunk) => ({
      name: chunk.name,
      value: set.encoded ? encodeURIComponent(chunk.value) : chunk.value,
      domain: template.domain,
      path: template.path,
      httpOnly: template.httpOnly,
      secure: template.secure,
      sameSite: template.sameSite,
    })),
  );
}

// ---------------------------------------------------------------------------
// 로컬 Auth 서버 직접 호출 (테스트 전용, 키는 환경 변수에서만 읽고 출력하지 않는다)
// ---------------------------------------------------------------------------

export type LocalAuthConfig = { url: string; anonKey: string; serviceRoleKey: string };

export function readLocalAuthConfig(): LocalAuthConfig | null {
  const url = (
    process.env.AUTH_TEST_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    ''
  ).trim();
  const anonKey = (
    process.env.AUTH_TEST_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ''
  ).trim();
  const serviceRoleKey = (process.env.AUTH_TEST_SERVICE_ROLE_KEY ?? '').trim();

  if (url === '' || anonKey === '') return null;

  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('로컬(loopback) Auth 인스턴스에서만 실행합니다.');
  }
  return { url: new URL(url).origin, anonKey, serviceRoleKey };
}

/**
 * 이 사용자의 모든 refresh token을 서버에서 폐기한다(global scope 로그아웃).
 * 성공 여부만 돌려준다. 토큰은 출력하지 않는다.
 */
export async function revokeAllSessions(
  config: LocalAuthConfig,
  accessToken: string,
): Promise<boolean> {
  const response = await fetch(`${config.url}/auth/v1/logout?scope=global`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return response.ok;
}

/**
 * 로컬 Auth 관리 API로 메일을 보내지 않고 복구용 token_hash를 만든다.
 * 실제 메일 전달 경로는 이 방법으로 검증되지 않는다(문서에 한계로 적었다).
 */
export async function generateRecoveryTokenHash(
  config: LocalAuthConfig,
  email: string,
): Promise<string | null> {
  if (config.serviceRoleKey === '') return null;

  const response = await fetch(`${config.url}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'recovery', email }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as { hashed_token?: string };
  return payload.hashed_token ?? null;
}

/** 테스트 안에서만 쓰는 임시 비밀번호. 파일·로그에 남기지 않는다. */
export function temporaryPassword(): string {
  return `E2e-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}-Aa1!`;
}
