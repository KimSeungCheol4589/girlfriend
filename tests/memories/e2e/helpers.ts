import { randomUUID } from 'node:crypto';

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { login } from '../../auth/e2e/helpers';
import {
  loadMemAccounts,
  readMemTestEnv,
  rpc,
  select,
  signIn,
  type MemAccount,
  type MemAccounts,
  type MemTestEnv,
} from '../support/local-api';

/**
 * MEM-001 E2E 공용 도우미.
 * 로그인 화면 조작은 인증 E2E 도우미(`login`)를 읽기 전용으로 재사용한다(인증 픽스처는 건드리지 않는다).
 */

export function requireEnv(): { env: MemTestEnv; accounts: MemAccounts } {
  const env = readMemTestEnv();
  if (!env) throw new Error('MEM_TEST_SUPABASE_URL / MEM_TEST_ANON_KEY가 필요합니다.');
  return { env, accounts: loadMemAccounts() };
}

export type Session = { context: BrowserContext; page: Page };

export async function openSession(
  browser: Browser,
  account: MemAccount,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<Session> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await login(page, account);
  return { context, page };
}

/** 한 번의 실행에서 겹치지 않는 표식. 제목·태그에 붙여 다른 실행의 데이터와 구분한다. */
export function runMarker(): string {
  return `${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 5)}`;
}

export type ApiMemoryInput = {
  title: string;
  memoryDate: string;
  tags?: string[];
  body?: string;
  location?: string | null;
  photoAssetIds?: string[];
  isPinned?: boolean;
};

/** 사용자 JWT로 save_memory RPC를 직접 호출해 기록을 만든다(화면을 거치지 않는 준비용). */
export async function createMemoryViaApi(env: MemTestEnv, token: string, input: ApiMemoryInput): Promise<string> {
  const result = await rpc<{ memoryId: string }>(env, token, 'save_memory', {
    p_memory_id: null,
    p_title: input.title,
    p_body: input.body ?? '',
    p_memory_date: input.memoryDate,
    p_location: input.location ?? null,
    p_tags: input.tags ?? [],
    p_photo_asset_ids: input.photoAssetIds ?? [],
    p_is_pinned: input.isPinned ?? false,
    p_expected_version: 0,
    p_request_id: randomUUID(),
  });
  expect(result.status, 'save_memory 준비 호출').toBe(200);
  const memoryId = result.data?.memoryId;
  if (!memoryId) throw new Error('save_memory 응답에 memoryId가 없습니다.');
  return memoryId;
}

export async function countByTitle(env: MemTestEnv, token: string, title: string): Promise<number> {
  const result = await select<{ id: string }[]>(
    env,
    token,
    'memories',
    `select=id&title=eq.${encodeURIComponent(title)}`,
  );
  return result.data?.length ?? -1;
}

export async function tokenFor(env: MemTestEnv, account: MemAccount): Promise<string> {
  return signIn(env, account);
}

/** 상세 화면의 기록 ID(경로에서). */
export function memoryIdFromPath(page: Page): string {
  const match = /^\/memories\/([0-9a-f-]{36})$/.exec(new URL(page.url()).pathname);
  if (!match?.[1]) throw new Error('상세 화면 경로가 아닙니다.');
  return match[1];
}

export async function waitForMemoryDetail(page: Page, title: string): Promise<string> {
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page).toHaveURL(/\/memories\/[0-9a-f-]{36}(\?.*)?$/);
  return memoryIdFromPath(page);
}

export const NOT_FOUND_HEADING = '이 기록을 찾을 수 없어요';

export function tomorrowInSeoul(): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, (day ?? 1) + 1)).toISOString().slice(0, 10);
}

/** 가로 스크롤이 생기지 않는지(모바일 배치 확인용). */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

/** 현재 화면에서 Server Action POST만 골라낸다. */
export function isServerActionRequest(method: string, headers: Record<string, string>): boolean {
  return method === 'POST' && typeof headers['next-action'] === 'string';
}
