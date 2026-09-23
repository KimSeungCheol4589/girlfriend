import { randomUUID } from 'node:crypto';

import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { login } from '../../auth/e2e/helpers';
import {
  loadThemeAccounts,
  parseErrorDetails,
  readThemeTestEnv,
  rpc,
  select,
  signIn,
  syntheticPng,
  type RestResult,
  type ThemeAccount,
  type ThemeAccounts,
  type ThemeTestEnv,
} from '../support/local-api';

/**
 * THEME-001 E2E 공용 도우미.
 * 로그인 화면 조작은 인증 E2E 도우미(`login`)를 읽기 전용으로 재사용한다(인증 픽스처는 건드리지 않는다).
 */

export function requireEnv(): { env: ThemeTestEnv; accounts: ThemeAccounts } {
  const env = readThemeTestEnv();
  if (!env) throw new Error('THEME_TEST_SUPABASE_URL / THEME_TEST_ANON_KEY가 필요합니다.');
  return { env, accounts: loadThemeAccounts() };
}

export type Session = { context: BrowserContext; page: Page };

export async function openSession(
  browser: Browser,
  account: ThemeAccount,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<Session> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await login(page, account);
  return { context, page };
}

export async function tokenFor(env: ThemeTestEnv, account: ThemeAccount): Promise<string> {
  return signIn(env, account);
}

export type SettingsRow = {
  theme_key: string;
  accent_color: string;
  cover_asset_id: string | null;
  home_sections: { key: string; visible: boolean }[];
  version: number;
};

/** 저장된 공유 설정을 사용자 세션으로 직접 읽는다(화면이 말하는 것과 DB를 따로 확인한다). */
export async function readSettings(env: ThemeTestEnv, token: string): Promise<SettingsRow> {
  const result = await select<SettingsRow[]>(
    env,
    token,
    'space_settings',
    'select=theme_key,accent_color,cover_asset_id,home_sections,version',
  );
  const row = result.data?.[0];
  if (!row) throw new Error(`공유 설정을 읽지 못했습니다(HTTP ${result.status}).`);
  return row;
}

/** 화면을 거치지 않고 설정을 바꾼다(상대방이 먼저 저장한 상황을 만들 때 쓴다). */
export async function saveSettingsViaApi(
  env: ThemeTestEnv,
  token: string,
  input: {
    themeKey: string;
    accentColor: string;
    coverAssetId?: string | null;
    sections?: { key: string; visible: boolean }[];
    expectedVersion: number;
  },
): Promise<number> {
  const result = await rpc<{ version: number }>(env, token, 'save_customization', {
    p_theme_key: input.themeKey,
    p_accent_color: input.accentColor,
    p_cover_asset_id: input.coverAssetId ?? null,
    p_home_sections: input.sections ?? [
      { key: 'pinned', visible: true },
      { key: 'recentMemories', visible: true },
      { key: 'wishlist', visible: true },
    ],
    p_expected_version: input.expectedVersion,
    p_request_id: randomUUID(),
  });
  expect(result.status, 'save_customization 준비 호출').toBe(200);
  return result.data?.version ?? -1;
}

/** 설정을 알려진 기본값으로 되돌린다(스펙 사이의 실행 순서에 기대지 않기 위해). */
export async function resetSettings(env: ThemeTestEnv, token: string): Promise<SettingsRow> {
  const current = await readSettings(env, token);
  await saveSettingsViaApi(env, token, {
    themeKey: 'cream',
    accentColor: '#8b435a',
    coverAssetId: current.cover_asset_id,
    expectedVersion: current.version,
  });
  return readSettings(env, token);
}

export type ApiMemoryInput = { title: string; memoryDate: string; isPinned?: boolean };

/** 사용자 JWT로 save_memory를 직접 호출해 고정 후보를 만든다(화면을 거치지 않는 준비용). */
export async function createMemoryViaApi(
  env: ThemeTestEnv,
  token: string,
  input: ApiMemoryInput,
): Promise<string> {
  const result = await rpc<{ memoryId: string }>(env, token, 'save_memory', {
    p_memory_id: null,
    p_title: input.title,
    p_body: '',
    p_memory_date: input.memoryDate,
    p_location: null,
    p_tags: [],
    p_photo_asset_ids: [],
    p_is_pinned: input.isPinned ?? false,
    p_expected_version: 0,
    p_request_id: randomUUID(),
  });
  expect(result.status, 'save_memory 준비 호출').toBe(200);
  const memoryId = result.data?.memoryId;
  if (!memoryId) throw new Error('save_memory 응답에 memoryId가 없습니다.');
  return memoryId;
}

/** 브라우저 파일 선택에 넣을 합성 이미지. */
export function coverFile(name = 'cover.png'): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: 'image/png', buffer: syntheticPng(320, 180, [180, 120, 150]) };
}

/** 한 번의 실행에서 겹치지 않는 표식. */
export function runMarker(): string {
  return `${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 5)}`;
}

/** 가로 스크롤이 생기지 않는지(모바일 배치 확인용). */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

export const CUSTOMIZE_HEADING = '꾸미기';
export const SAVE_BUTTON = '꾸미기 저장';
export const CANCEL_BUTTON = '취소하고 되돌리기';

/** 꾸미기 화면이 실제로 그려질 때까지 기다린다(주소가 아니라 내용으로 판정한다). */
export async function openCustomize(page: Page): Promise<void> {
  await page.goto('/customize');
  await expect(page.getByRole('heading', { level: 1, name: CUSTOMIZE_HEADING })).toBeVisible();
}

// ---------------------------------------------------------------------------
// 선택자 — 이름이 겹치는 버튼이 많아 영역을 좁혀서 고른다
// ---------------------------------------------------------------------------

/**
 * 테마 고르기 버튼.
 *
 * 접근 이름만으로 고르면 포인트 색상 프리셋(세이지·로즈 등)과 겹친다.
 * Playwright의 이름 일치는 기본이 **부분 일치**라 테마 설명 문구까지 매칭돼 더 헷갈린다.
 * 그래서 테마 목록 안에서만 고른다.
 */
export function themeButton(page: Page, label: ThemeLabel): Locator {
  return page.getByTestId('theme-picker').getByRole('button', { name: label });
}

export type ThemeLabel = '크림' | '로즈' | '세이지';
export type ThemeChoice = { key: 'cream' | 'rose' | 'sage'; label: ThemeLabel };

const THEME_CHOICES: readonly ThemeChoice[] = [
  { key: 'cream', label: '크림' },
  { key: 'rose', label: '로즈' },
  { key: 'sage', label: '세이지' },
];

/**
 * 지금 저장된 테마와 **다른** 테마 하나.
 *
 * 저장 버튼은 바뀐 것이 있을 때만 활성화된다. 검증이 테마 값을 고정해 두면, 앞선 검증이나 이전
 * 실행이 남긴 설정이 우연히 같은 값일 때 "저장할 변경 없음"이 되어 버튼을 기다리다 시간이 초과된다.
 * 공유 설정을 초기화하는 대신 **지금 값을 읽어 다른 값을 고른다.**
 */
export function otherThemeThan(themeKey: string): ThemeChoice {
  const found = THEME_CHOICES.find((choice) => choice.key !== themeKey);
  // 목록이 셋이므로 항상 찾는다. 알 수 없는 값이 와도 첫 선택지로 안전하게 떨어진다.
  return found ?? (THEME_CHOICES[0] as ThemeChoice);
}

/** 포인트 색상 프리셋 버튼(이름이 정확히 일치하는 것만). */
export function accentPresetButton(page: Page, label: string): Locator {
  return page.getByTestId('accent-picker').getByRole('button', { name: label, exact: true });
}

/**
 * 확인 대화상자의 버튼.
 * 화면에도 ‘취소하고 되돌리기’·‘저장된 커버로 되돌리기’가 있어 대화상자 안으로 좁혀야 한다.
 */
export function confirmDialogButton(page: Page, name: string): Locator {
  return page.getByRole('alertdialog').getByRole('button', { name, exact: true });
}

/** ‘취소하고 되돌리기’ → 확인까지. 저장하지 않은 변경만 되돌린다. */
export async function cancelToSaved(page: Page): Promise<void> {
  await page.getByRole('button', { name: CANCEL_BUTTON }).click();
  await confirmDialogButton(page, '되돌리기').click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
}

/**
 * 홈의 커버 사진(있으면).
 * 불러오지 못하면 컴포넌트가 스스로 숨기므로, 이 요소가 없다는 것은
 * "커버가 없거나 사진을 불러오지 못했다"는 뜻이다.
 */
export function homeCoverImage(page: Page): Locator {
  return page.getByTestId('home-cover').locator('img');
}

export function coverUrlFor(assetId: string): string {
  return `/customize/cover/${assetId}`;
}

/**
 * 화면이 보여 주는 실패 안내.
 *
 * `getByRole('alert')`만 쓰면 Next.js의 라우트 안내 요소(`__next-route-announcer__`, role=alert)까지
 * 걸린다. 본문 안으로 좁혀 화면이 그린 안내만 고른다.
 */
export function editorAlert(page: Page): Locator {
  return page.getByRole('main').getByRole('alert');
}

/**
 * 사용자 RPC가 **계약된 SQLSTATE**로 거부했는지 확인한다.
 *
 * PostgREST는 사용자 정의 SQLSTATE(`GF4xx`)를 HTTP 400으로 내보낸다. 그래서 HTTP 코드가 아니라
 * `code`(SQLSTATE)를 본다. 비공개 GET 경로(`/customize/cover/...`)가 돌려주는 실제 HTTP 404와
 * 혼동하지 않는다. 어떤 4xx든 통과시키는 느슨한 단언은 쓰지 않는다.
 *
 * `details`를 주면 DB가 실은 필드 힌트까지 확인한다(예: `{ coverAssetId: 'purpose' }`).
 */
export function expectRpcError(
  result: RestResult<unknown>,
  sqlstate: string,
  label: string,
  details?: Record<string, string>,
): void {
  expect(result.code, `${label}: SQLSTATE`).toBe(sqlstate);
  expect(result.status, `${label}: 성공 응답이 아니다`).toBeGreaterThanOrEqual(400);
  expect(result.data, `${label}: 결과 없음`).toBeNull();
  if (details) {
    expect(parseErrorDetails(result.details), `${label}: DETAIL 힌트`).toMatchObject(details);
  }
}
