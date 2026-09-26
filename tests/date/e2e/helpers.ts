import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { login as authLogin, logout as authLogout, waitForScreen } from '../../auth/e2e/helpers';

/**
 * DATE-001 E2E 공용 도우미.
 *
 * 규칙
 *   - 계정은 `date-e2e-*` 합성 계정만 쓴다(`.agent-runtime/date-e2e/accounts.json`).
 *     AUTH·MEM·FOOD·WISH·CAL 계정은 읽지 않는다.
 *   - 비밀번호·토큰·키를 단언 값·로그에 넣지 않는다.
 *   - 직접 API 호출은 **공개 키 + 사용자 세션**으로만 한다(앱과 같은 권한). 관리자 키는 쓰지 않는다.
 *   - 화면 판정은 렌더된 내용으로 한다(서버 리다이렉트는 스트리밍으로 온다. tests/auth/README.md 6).
 */

export type DateAccount = { email: string; password: string; userId: string | null };
export type DateAccounts = Record<'a' | 'b' | 'c', DateAccount>;

const ACCOUNTS_PATH = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.agent-runtime',
  'date-e2e',
  'accounts.json',
);

export function loadDateAccounts(): DateAccounts {
  let raw: string;
  try {
    raw = readFileSync(ACCOUNTS_PATH, 'utf8');
  } catch {
    throw new Error(
      'date-e2e 합성 계정 정보가 없습니다. 먼저 `node tests/date/fixtures/cli.mjs setup`을 실행하세요.',
    );
  }
  const accounts = (JSON.parse(raw) as { accounts?: Partial<DateAccounts> }).accounts;
  for (const key of ['a', 'b', 'c'] as const) {
    const account = accounts?.[key];
    if (
      !account ||
      !account.email.startsWith('date-e2e-') ||
      !account.email.endsWith('@test.invalid')
    ) {
      throw new Error(
        `date-e2e 합성 계정(${key})이 없거나 형식이 다릅니다. 픽스처 setup을 다시 실행하세요.`,
      );
    }
  }
  return accounts as DateAccounts;
}

/** 이번 실행을 구분하는 짧은 태그. 제목에 붙여 다른 실행·다른 테스트와 섞이지 않게 한다. */
export const RUN_TAG = Date.now().toString(36).slice(-6);

export function uniqueTitle(label: string): string {
  return `D1 ${label} ${RUN_TAG}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// 날짜 — 테스트가 보는 달과 화면이 보는 달을 같게 맞춘다(한국 시간 기준)
// ---------------------------------------------------------------------------

const seoulDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 한국 날짜 기준 N일 뒤 `YYYY-MM-DD`. 음수면 과거다. */
export function seoulDateInDays(days: number): string {
  return seoulDateFormatter.format(new Date(Date.now() + days * 86_400_000));
}

export function seoulToday(): string {
  return seoulDateInDays(0);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * 이 스위트가 쓰는 "안전한 달".
 *
 * 달 경계에서 실행하면 오늘과 며칠 뒤가 서로 다른 달이 될 수 있다. 그러면 "같은 달 안에서
 * 여러 일정을 만들고 함께 본다"는 단언이 날짜 때문에 흔들린다. 그래서 **다음 달 중순**을 기준일로
 * 잡아 며칠 앞뒤로 움직여도 달이 바뀌지 않게 한다.
 */
export function stableMonthDay(day: number): string {
  const today = seoulToday();
  const [year, month] = today.split('-').map(Number);
  const nextMonthIndex = (month as number) % 12;
  const nextYear = nextMonthIndex === 0 ? (year as number) + 1 : (year as number);
  const nextMonth = nextMonthIndex === 0 ? 12 : nextMonthIndex + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function koreanDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** `2026년 10월 15일 (목)`. 월 격자의 날짜 라벨과 같은 표기다. */
export function koreanDateWithWeekday(iso: string): string {
  // 정오 UTC로 만들어 시간대 보정에 흔들리지 않게 한다(화면 코드와 같은 방식).
  const weekday = WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
  return `${koreanDate(iso)} (${weekday})`;
}

export function koreanMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year}년 ${month}월`;
}

// ---------------------------------------------------------------------------
// 화면
// ---------------------------------------------------------------------------

export async function login(page: Page, account: DateAccount): Promise<void> {
  await authLogin(page, account);
}

export async function logout(page: Page): Promise<void> {
  await authLogout(page);
}

/** 새 브라우저 컨텍스트에서 로그인한 페이지. 두 사람을 동시에 흉내 낼 때 쓴다. */
export async function openAs(
  browser: Browser,
  account: DateAccount,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, account);
  return { context, page };
}

export async function gotoCalendar(page: Page, query = ''): Promise<void> {
  await page.goto(`/calendar${query}`);
  await expect(page.getByRole('heading', { name: '커플 캘린더', exact: true })).toBeVisible();
}

/** 지정한 달의 캘린더로 이동한다. */
export async function gotoMonth(page: Page, monthKey: string, extra = ''): Promise<void> {
  await gotoCalendar(page, `?month=${monthKey}${extra}`);
  await expect(page.getByTestId('calendar-month')).toHaveText(koreanMonth(monthKey));
}

export async function gotoDetail(page: Page, id: string): Promise<void> {
  await page.goto(`/calendar/${id}`);
  await expect(page.getByRole('heading', { name: '상태', exact: true })).toBeVisible();
}

export function eventIdFromUrl(page: Page): string {
  const match = /\/calendar\/([0-9a-f-]{36})(?:$|[/?#])/.exec(new URL(page.url()).pathname + '#');
  if (!match?.[1]) throw new Error('일정 상세 주소가 아닙니다.');
  return match[1];
}

export type EventFormInput = {
  title: string;
  kind?: 'personal' | 'date';
  allDay?: boolean;
  startDate: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  location?: string;
  note?: string;
  /** 위시 연결 선택지의 보이는 이름. */
  wishTitle?: string;
};

export async function fillEventForm(page: Page, input: EventFormInput): Promise<void> {
  if (input.kind) await page.getByLabel('일정 종류').selectOption(input.kind);
  await page.getByLabel('제목').fill(input.title);

  const allDay = page.getByLabel('종일 일정');
  if (input.allDay === true) await allDay.check();
  if (input.allDay === false) await allDay.uncheck();

  await page.getByLabel('시작 날짜').fill(input.startDate);
  if (!input.allDay) {
    await page.getByLabel('시작 시각').fill(input.startTime ?? '19:00');
  }
  await page.getByLabel('끝나는 날짜').fill(input.endDate ?? '');
  if (!input.allDay) {
    await page.getByLabel('끝나는 시각').fill(input.endTime ?? '');
  }
  await page.getByLabel('장소').fill(input.location ?? '');
  await page.getByLabel('메모').fill(input.note ?? '');
  if (input.wishTitle) {
    await page.getByLabel('위시 연결').selectOption({ label: input.wishTitle });
  }
}

/** UI로 일정을 만들고 상세 화면의 ID를 돌려준다. */
export async function createEventViaUi(page: Page, input: EventFormInput): Promise<string> {
  await page.goto('/calendar/new');
  await expect(page.getByRole('heading', { name: '일정 추가' })).toBeVisible();
  await fillEventForm(page, input);
  await page.getByRole('button', { name: '일정 등록' }).click();
  await expect(page.getByRole('heading', { name: input.title })).toBeVisible();
  return eventIdFromUrl(page);
}

export { waitForScreen };

// ---------------------------------------------------------------------------
// 직접 API (공개 키 + 사용자 세션) — 앱을 거치지 않는 우회 시도와 경쟁 재현에 쓴다
// ---------------------------------------------------------------------------

function readPublicConfig(): { url: string; anonKey: string } {
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
export async function userClient(account: DateAccount): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (error) throw new Error(`API 로그인 실패(status=${error.status ?? 'unknown'})`);
  return client;
}

export type RpcOutcome =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string; details: string };

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

export type ApiEventInput = {
  title: string;
  kind?: 'personal' | 'date';
  allDay?: boolean;
  startDate: string;
  startTime?: string | null;
  endDate?: string | null;
  endTime?: string | null;
  location?: string | null;
  note?: string;
  wishItemId?: string | null;
};

export function eventArgs(
  input: ApiEventInput,
  extra: { eventId?: string | null; expectedVersion?: number } = {},
): Record<string, unknown> {
  const allDay = input.allDay ?? false;
  // `startTime: null`은 "시각을 보내지 않는다"는 **명시적** 입력이다. 기본값으로 채우면
  // "시작 시각 없는 시간 일정을 DB가 거부한다"를 검증할 수 없다(undefined일 때만 기본값을 쓴다).
  const startTime = input.startTime === undefined ? '19:00' : input.startTime;
  return {
    p_event_id: extra.eventId ?? null,
    p_kind: input.kind ?? 'date',
    p_title: input.title,
    p_location: input.location ?? null,
    p_note: input.note ?? '',
    p_all_day: allDay,
    p_start_date: input.startDate,
    p_start_time: allDay ? null : startTime,
    p_end_date: input.endDate ?? null,
    p_end_time: allDay ? null : (input.endTime ?? null),
    p_wish_item_id: input.wishItemId ?? null,
    p_expected_version: extra.expectedVersion ?? 0,
  };
}

export async function apiCreateEvent(
  client: SupabaseClient,
  input: ApiEventInput,
  requestId: string = newRequestId(),
): Promise<string> {
  const result = await callRpc(client, 'save_calendar_event', {
    ...eventArgs(input),
    p_request_id: requestId,
  });
  if (!result.ok) throw new Error(`save_calendar_event 실패 code=${result.code}`);
  return String(result.data.eventId);
}

export async function apiSetStatus(
  client: SupabaseClient,
  id: string,
  status: string,
  version: number,
): Promise<number> {
  const result = await callRpc(client, 'set_calendar_event_status', {
    p_event_id: id,
    p_status: status,
    p_expected_version: version,
    p_request_id: newRequestId(),
  });
  if (!result.ok) throw new Error(`set_calendar_event_status 실패 code=${result.code}`);
  return Number(result.data.version);
}

export type StoredEvent = {
  id: string;
  kind: string;
  owner_id: string | null;
  created_by: string;
  title: string;
  location: string | null;
  note: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  status: string;
  wish_item_id: string | null;
  version: number;
};

export async function apiEvent(
  client: SupabaseClient,
  id: string,
): Promise<StoredEvent | null> {
  const { data, error } = await client
    .from('calendar_events')
    .select(
      'id, kind, owner_id, created_by, title, location, note, starts_at, ends_at, all_day, status, wish_item_id, version',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`calendar_events 조회 실패 code=${error.code}`);
  return data as StoredEvent | null;
}

export async function apiCountByTitle(client: SupabaseClient, title: string): Promise<number> {
  const { count, error } = await client
    .from('calendar_events')
    .select('id', { count: 'exact', head: true })
    .eq('title', title);
  if (error) throw new Error(`calendar_events 개수 조회 실패 code=${error.code}`);
  return count ?? 0;
}

/** 저장된 timestamptz를 한국 날짜·시:분으로 읽는다(화면과 같은 기준). */
export function seoulParts(value: string): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const found: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(value))) {
    if (part.type !== 'literal') found[part.type] = part.value;
  }
  return { date: `${found.year}-${found.month}-${found.day}`, time: `${found.hour}:${found.minute}` };
}

// ---------------------------------------------------------------------------
// 위시 (CAL 연결 확인에만 쓴다. 위시 화면은 이 작업에서 수정하지 않는다)
// ---------------------------------------------------------------------------

export async function apiCreateWish(client: SupabaseClient, title: string): Promise<string> {
  const result = await callRpc(client, 'save_wish', {
    p_wish_id: null,
    p_title: title,
    p_category: 'activity',
    p_memo: '',
    p_link_url: null,
    p_expected_version: 0,
    p_request_id: newRequestId(),
  });
  if (!result.ok) throw new Error(`save_wish 실패 code=${result.code}`);
  return String(result.data.wishId);
}

export async function apiDeleteWish(
  client: SupabaseClient,
  id: string,
  version: number,
): Promise<RpcOutcome> {
  return callRpc(client, 'delete_wish', {
    p_wish_id: id,
    p_expected_version: version,
    p_request_id: newRequestId(),
  });
}

export async function apiWishExists(client: SupabaseClient, id: string): Promise<boolean> {
  const { count, error } = await client
    .from('wish_items')
    .select('id', { count: 'exact', head: true })
    .eq('id', id);
  if (error) throw new Error(`wish_items 조회 실패 code=${error.code}`);
  return (count ?? 0) > 0;
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

// ---------------------------------------------------------------------------
// DATE-001 전용 — 원본(완료한 일정·해낸 위시)과 데이트 기록
// ---------------------------------------------------------------------------

/** 위시 상세로 이동한다. */
export async function gotoWishDetail(page: Page, wishId: string): Promise<void> {
  await page.goto(`/wishes/${wishId}`);
  await expect(page.getByRole('heading', { name: '데이트 기록', exact: true })).toBeVisible();
}

/** 원본 상세의 "데이트 기록" 칸. */
export function dateRecordsPanel(page: Page) {
  return page.getByRole('region', { name: '데이트 기록' });
}

/**
 * 해낸 위시 하나를 RPC로 만든다.
 *
 * 화면 조작으로 만들면 위시 폼·상태 패널의 세부 변화에 이 스위트가 묶인다. 여기서 확인하려는 것은
 * 위시 기능이 아니라 **연결 계약**이므로, 원본은 사용자 세션 RPC로 빠르게 준비한다.
 */
export async function createDoneWish(account: DateAccount, title: string): Promise<string> {
  const client = await userClient(account);
  const created = await callRpc(client, 'save_wish', {
    p_wish_id: null,
    p_title: title,
    p_category: 'activity',
    p_memo: '',
    p_link_url: null,
    p_expected_version: 0,
    p_request_id: newRequestId(),
  });
  if (created.ok !== true) throw new Error(`위시를 만들지 못했습니다: ${created.code}`);
  const wishId = (created.data as { wishId?: string }).wishId;
  const version = (created.data as { version?: number }).version;
  if (!wishId || typeof version !== 'number') throw new Error('위시 생성 응답 형식이 다릅니다.');

  const done = await callRpc(client, 'set_wish_status', {
    p_wish_id: wishId,
    p_status: 'done',
    p_planned_date: seoulToday(),
    p_expected_version: version,
    p_request_id: newRequestId(),
  });
  if (done.ok !== true) throw new Error(`위시를 완료로 바꾸지 못했습니다: ${done.code}`);
  return wishId;
}

/** 완료한 공동 일정 하나를 RPC로 만든다. */
export async function createDoneEvent(account: DateAccount, title: string): Promise<string> {
  const client = await userClient(account);
  const created = await callRpc(client, 'save_calendar_event', {
    p_event_id: null,
    p_kind: 'date',
    p_title: title,
    p_note: '',
    p_location: null,
    p_all_day: true,
    p_start_date: seoulToday(),
    p_start_time: null,
    p_end_date: null,
    p_end_time: null,
    p_wish_item_id: null,
    p_expected_version: 0,
    p_request_id: newRequestId(),
  });
  if (created.ok !== true) throw new Error(`일정을 만들지 못했습니다: ${created.code}`);
  const eventId = (created.data as { eventId?: string }).eventId;
  const version = (created.data as { version?: number }).version;
  if (!eventId || typeof version !== 'number') throw new Error('일정 생성 응답 형식이 다릅니다.');

  const done = await callRpc(client, 'set_calendar_event_status', {
    p_event_id: eventId,
    p_status: 'done',
    p_expected_version: version,
    p_request_id: newRequestId(),
  });
  if (done.ok !== true) throw new Error(`일정을 완료로 바꾸지 못했습니다: ${done.code}`);
  return eventId;
}

/** 추억 상세 주소에서 id를 읽는다. */
export function memoryIdFromUrl(page: Page): string {
  const match = /\/memories\/([0-9a-f-]{36})(?:$|[/?#])/.exec(new URL(page.url()).pathname + '#');
  if (!match?.[1]) throw new Error('추억 상세 주소가 아닙니다.');
  return match[1];
}

/**
 * RPC 성공을 단언하고 결과를 좁혀 준다.
 *
 * `expect(outcome.ok).toBe(true)`만 쓰면 타입이 좁아지지 않아 `outcome.data`를 읽을 수 없다.
 * 실패 원인(SQLSTATE)을 메시지에 담아 어떤 계약이 깨졌는지 바로 보이게 한다.
 */
export function assertRpcOk(outcome: RpcOutcome, label: string): Record<string, unknown> {
  if (!outcome.ok) throw new Error(`${label} 실패: SQLSTATE ${outcome.code || '(없음)'}`);
  return outcome.data;
}

/** RPC 실패를 단언하고 코드·힌트를 좁혀 준다. */
export function assertRpcFailed(outcome: RpcOutcome, label: string): { code: string; details: string } {
  if (outcome.ok) throw new Error(`${label}: 거부돼야 하는데 성공했습니다.`);
  return { code: outcome.code, details: outcome.details };
}
