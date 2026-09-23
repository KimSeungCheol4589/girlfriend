import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

/**
 * THEME-001 실제 백엔드 테스트 공용 도우미 — **로컬(loopback) Supabase 전용**.
 *
 * MEM-001의 같은 파일(tests/memories/support/local-api.ts)을 복사해 이름 공간만 바꿨다.
 * 환경 변수(`THEME_TEST_*`)와 계정 파일(`.agent-runtime/customize-e2e/accounts.json`)이 달라
 * 두 작업의 합성 데이터가 섞이지 않는다.
 *
 * 규칙
 *   - 키·비밀번호·토큰·파일 경로를 출력하거나 단언 메시지에 넣지 않는다.
 *   - 합성 계정(`theme-e2e-*@test.invalid`)과 그 공간만 다룬다.
 *   - 주소가 loopback이 아니면 즉시 멈춘다.
 *   - 이 파일의 호출은 모두 **실제 로컬 서비스**로 간다. 모의 응답을 만들지 않는다.
 */

export type ThemeTestEnv = {
  url: string;
  anonKey: string;
  serviceKey: string | null;
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function readThemeTestEnv(env: NodeJS.ProcessEnv = process.env): ThemeTestEnv | null {
  const url = (env.THEME_TEST_SUPABASE_URL ?? '').trim();
  const anonKey = (env.THEME_TEST_ANON_KEY ?? '').trim();
  const serviceKey = (env.THEME_TEST_SERVICE_ROLE_KEY ?? '').trim();
  if (url === '' || anonKey === '') return null;
  if (env.NODE_ENV === 'production') throw new Error('NODE_ENV=production에서는 실행하지 않습니다.');

  const parsed = new URL(url);
  if (!LOOPBACK.has(parsed.hostname)) {
    throw new Error('THEME-001 테스트는 로컬(loopback) Supabase에서만 실행합니다.');
  }
  return { url: parsed.origin, anonKey, serviceKey: serviceKey === '' ? null : serviceKey };
}

export type ThemeAccount = { email: string; password: string; userId: string | null };
export type ThemeAccounts = { a: ThemeAccount; b: ThemeAccount; c: ThemeAccount };

export const THEME_ACCOUNTS_PATH = join(process.cwd(), '.agent-runtime', 'customize-e2e', 'accounts.json');

export function loadThemeAccounts(): ThemeAccounts {
  let raw: string;
  try {
    raw = readFileSync(THEME_ACCOUNTS_PATH, 'utf8');
  } catch {
    throw new Error('합성 계정 정보가 없습니다. 먼저 `node tests/customize/fixtures/cli.mjs setup`을 실행하세요.');
  }
  const parsed = JSON.parse(raw) as { accounts?: Partial<ThemeAccounts> };
  const accounts = parsed.accounts;
  if (!accounts?.a || !accounts.b || !accounts.c) {
    throw new Error('합성 계정(a, b, c)이 모두 있어야 합니다. 픽스처 setup을 다시 실행하세요.');
  }
  for (const account of [accounts.a, accounts.b, accounts.c]) {
    // 다른 작업(mem-e2e·auth-e2e)의 계정을 실수로 쓰지 않는다.
    if (!/^theme-e2e[a-z0-9-]*@test\.invalid$/.test(account.email)) {
      throw new Error('theme-e2e 합성 계정만 사용할 수 있습니다.');
    }
  }
  return accounts as ThemeAccounts;
}

// ---------------------------------------------------------------------------
// Auth / REST / Storage (fetch만 사용, 응답 본문을 출력하지 않는다)
// ---------------------------------------------------------------------------

export async function signIn(env: ThemeTestEnv, account: ThemeAccount): Promise<string> {
  const response = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (!response.ok) throw new Error(`로그인 실패: HTTP ${response.status}`);
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error('로그인 응답에 토큰이 없습니다.');
  return payload.access_token;
}

export type RestResult<T = unknown> = { status: number; data: T | null; code: string | null; details: string | null };

function userHeaders(env: ThemeTestEnv, token: string | null): Record<string, string> {
  return { apikey: env.anonKey, Authorization: `Bearer ${token ?? env.anonKey}` };
}

function serviceHeaders(env: ThemeTestEnv): Record<string, string> {
  if (!env.serviceKey) throw new Error('THEME_TEST_SERVICE_ROLE_KEY가 필요한 검증입니다.');
  return { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` };
}

async function toRestResult<T>(response: Response): Promise<RestResult<T>> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (response.ok) return { status: response.status, data: body as T, code: null, details: null };
  const error = (body ?? {}) as { code?: string; details?: string | null };
  return { status: response.status, data: null, code: error.code ?? null, details: error.details ?? null };
}

/** 사용자(또는 token=null이면 비로그인 anon)로 RPC 호출. */
export async function rpc<T = unknown>(
  env: ThemeTestEnv,
  token: string | null,
  fn: string,
  args: Record<string, unknown>,
): Promise<RestResult<T>> {
  const response = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...userHeaders(env, token), 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return toRestResult<T>(response);
}

/** 사용자(또는 비로그인)로 테이블 SELECT. RLS가 적용된다. */
export async function select<T = unknown[]>(
  env: ThemeTestEnv,
  token: string | null,
  table: string,
  query: string,
): Promise<RestResult<T>> {
  const response = await fetch(`${env.url}/rest/v1/${table}?${query}`, { headers: userHeaders(env, token) });
  return toRestResult<T>(response);
}

/** service_role SELECT(검증용 읽기만). */
export async function serviceSelect<T = unknown[]>(
  env: ThemeTestEnv,
  table: string,
  query: string,
): Promise<RestResult<T>> {
  const response = await fetch(`${env.url}/rest/v1/${table}?${query}`, { headers: serviceHeaders(env) });
  return toRestResult<T>(response);
}

export async function storageUpload(
  env: ThemeTestEnv,
  token: string | null,
  bucket: string,
  objectPath: string,
  bytes: Uint8Array,
  contentType: string,
  upsert = false,
): Promise<number> {
  const response = await fetch(`${env.url}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: { ...userHeaders(env, token), 'Content-Type': contentType, 'x-upsert': upsert ? 'true' : 'false' },
    body: Buffer.from(bytes),
  });
  await response.arrayBuffer().catch(() => undefined);
  return response.status;
}

export async function serviceDownload(
  env: ThemeTestEnv,
  bucket: string,
  objectPath: string,
): Promise<{ status: number; bytes: Uint8Array | null }> {
  const response = await fetch(`${env.url}/storage/v1/object/${bucket}/${objectPath}`, {
    headers: serviceHeaders(env),
  });
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    return { status: response.status, bytes: null };
  }
  return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
}

export function isMissingObjectStatus(status: number): boolean {
  // Storage는 없는 객체에 400(Object not found) 또는 404를 돌려준다.
  return status === 400 || status === 404;
}

/**
 * RPC 오류의 `DETAIL`(필드 힌트 JSON)을 객체로 바꾼다.
 *
 * DB는 `raise_error(코드, '{"필드":"사유"}')` 형태로 힌트를 싣는다(CONTRACTS.md 0).
 * 문자열을 부분 일치로 비교하면 공백·키 순서에 흔들리므로 파싱해서 본다. 형식이 다르면 빈 객체다.
 */
export function parseErrorDetails(details: unknown): Record<string, string> {
  let parsed: unknown = details;
  // 문자열로 올 때도 있고 이미 파싱된 객체로 올 때도 있다(앱의 parseErrorDetail과 같은 처리).
  if (typeof details === 'string') {
    if (details.trim().length === 0) return {};
    try {
      parsed = JSON.parse(details);
    } catch {
      return {};
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// 합성 이미지(의존성 없이 PNG를 만든다)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** 단색 RGB PNG. 브라우저가 다시 인코딩하므로 내용은 중요하지 않다. */
export function syntheticPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}
