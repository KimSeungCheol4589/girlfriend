import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

/**
 * MEM-001 실제 백엔드 테스트 공용 도우미 — **로컬(loopback) Supabase 전용**.
 *
 * 규칙
 *   - 키·비밀번호·토큰·파일 경로를 출력하거나 단언 메시지에 넣지 않는다.
 *   - 합성 계정(`mem-e2e-*@test.invalid`)과 그 공간만 다룬다.
 *   - 주소가 loopback이 아니면 즉시 멈춘다.
 *   - 이 파일의 호출은 모두 **실제 로컬 서비스**로 간다. 모의 응답을 만들지 않는다.
 */

export type MemTestEnv = {
  url: string;
  anonKey: string;
  serviceKey: string | null;
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function readMemTestEnv(env: NodeJS.ProcessEnv = process.env): MemTestEnv | null {
  const url = (env.MEM_TEST_SUPABASE_URL ?? env.AUTH_TEST_SUPABASE_URL ?? '').trim();
  const anonKey = (env.MEM_TEST_ANON_KEY ?? env.AUTH_TEST_ANON_KEY ?? '').trim();
  const serviceKey = (env.MEM_TEST_SERVICE_ROLE_KEY ?? env.AUTH_TEST_SERVICE_ROLE_KEY ?? '').trim();
  if (url === '' || anonKey === '') return null;
  if (env.NODE_ENV === 'production') throw new Error('NODE_ENV=production에서는 실행하지 않습니다.');

  const parsed = new URL(url);
  if (!LOOPBACK.has(parsed.hostname)) {
    throw new Error('MEM-001 테스트는 로컬(loopback) Supabase에서만 실행합니다.');
  }
  return { url: parsed.origin, anonKey, serviceKey: serviceKey === '' ? null : serviceKey };
}

export type MemAccount = { email: string; password: string; userId: string | null };
export type MemAccounts = { a: MemAccount; b: MemAccount; c: MemAccount };

export const MEM_ACCOUNTS_PATH = join(process.cwd(), '.agent-runtime', 'memories-e2e', 'accounts.json');

export function loadMemAccounts(): MemAccounts {
  let raw: string;
  try {
    raw = readFileSync(MEM_ACCOUNTS_PATH, 'utf8');
  } catch {
    throw new Error('합성 계정 정보가 없습니다. 먼저 `node tests/memories/fixtures/cli.mjs setup`을 실행하세요.');
  }
  const parsed = JSON.parse(raw) as { accounts?: Partial<MemAccounts> };
  const accounts = parsed.accounts;
  if (!accounts?.a || !accounts.b || !accounts.c) {
    throw new Error('합성 계정(a, b, c)이 모두 있어야 합니다. 픽스처 setup을 다시 실행하세요.');
  }
  for (const account of [accounts.a, accounts.b, accounts.c]) {
    if (!/^mem-e2e[a-z0-9-]*@test\.invalid$/.test(account.email)) {
      throw new Error('mem-e2e 합성 계정만 사용할 수 있습니다.');
    }
  }
  return accounts as MemAccounts;
}

// ---------------------------------------------------------------------------
// Auth / REST / Storage (fetch만 사용, 응답 본문을 출력하지 않는다)
// ---------------------------------------------------------------------------

export async function signIn(env: MemTestEnv, account: MemAccount): Promise<string> {
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

function userHeaders(env: MemTestEnv, token: string | null): Record<string, string> {
  return { apikey: env.anonKey, Authorization: `Bearer ${token ?? env.anonKey}` };
}

function serviceHeaders(env: MemTestEnv): Record<string, string> {
  if (!env.serviceKey) throw new Error('MEM_TEST_SERVICE_ROLE_KEY가 필요한 검증입니다.');
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
  env: MemTestEnv,
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
  env: MemTestEnv,
  token: string | null,
  table: string,
  query: string,
): Promise<RestResult<T>> {
  const response = await fetch(`${env.url}/rest/v1/${table}?${query}`, { headers: userHeaders(env, token) });
  return toRestResult<T>(response);
}

/** service_role SELECT(검증용 읽기만). */
export async function serviceSelect<T = unknown[]>(env: MemTestEnv, table: string, query: string): Promise<RestResult<T>> {
  const response = await fetch(`${env.url}/rest/v1/${table}?${query}`, { headers: serviceHeaders(env) });
  return toRestResult<T>(response);
}

export async function storageUpload(
  env: MemTestEnv,
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

/** 사용자 세션으로 인증 다운로드. 성공이면 바이트, 아니면 상태 코드만. */
export async function storageDownload(
  env: MemTestEnv,
  token: string | null,
  bucket: string,
  objectPath: string,
): Promise<{ status: number; bytes: Uint8Array | null }> {
  const response = await fetch(`${env.url}/storage/v1/object/authenticated/${bucket}/${objectPath}`, {
    headers: userHeaders(env, token),
  });
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    return { status: response.status, bytes: null };
  }
  return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
}

/** 비로그인 공개 경로 시도(비공개 버킷이면 실패해야 한다). */
export async function storagePublicDownload(env: MemTestEnv, bucket: string, objectPath: string): Promise<number> {
  const response = await fetch(`${env.url}/storage/v1/object/public/${bucket}/${objectPath}`);
  await response.arrayBuffer().catch(() => undefined);
  return response.status;
}

export async function serviceDownload(
  env: MemTestEnv,
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

/** 단색 RGB PNG. `textChunk`를 주면 tEXt 메타데이터를 넣는다(정규화 후 사라져야 한다). */
export function syntheticPng(width: number, height: number, rgb: [number, number, number], textChunk?: string): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header)];
  if (textChunk) parts.push(chunk('tEXt', Buffer.from(`Comment\0${textChunk}`, 'latin1')));
  parts.push(chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array()));
  return Buffer.concat(parts);
}

/** JPEG SOI 뒤에 EXIF(Orientation=6)를 끼워 넣는다. */
export function withExifOrientation6(jpeg: Uint8Array): Buffer {
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const length = payload.length + 2;
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff]), payload]);
  const source = Buffer.from(jpeg);
  return Buffer.concat([source.subarray(0, 2), app1, source.subarray(2)]);
}

export function uniqueTag(prefix: string): string {
  return `${prefix}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20);
}
