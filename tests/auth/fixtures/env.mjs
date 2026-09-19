/**
 * 인증 E2E 픽스처의 환경 읽기와 안전장치.
 *
 * 이 파일의 규칙은 "로컬 테스트 인스턴스 밖에서는 절대 실행되지 않는다"이다.
 *   - Supabase 주소가 loopback(127.0.0.1 / localhost / ::1)이 아니면 즉시 멈춘다.
 *   - 합성 계정 도메인은 `.invalid`만 쓴다(RFC 2606의 예약 TLD, 실제로 존재할 수 없다).
 *   - 비밀번호는 실행할 때마다 새로 만들고 화면·로그에 찍지 않는다.
 *   - 키·비밀번호는 어떤 출력에도 넣지 않는다.
 */

import { randomBytes } from 'node:crypto';

/**
 * A: 공간 생성 허용 계정 · B: 초대 대상 · C: 외부 계정 ·
 * D: 비밀번호 재설정 전용(실행 중 비밀번호가 바뀌므로 다른 시나리오와 분리한다).
 */
export const ACCOUNT_KEYS = /** @type {const} */ (['a', 'b', 'c', 'd']);

/** 합성 계정 도메인. 변경할 수 없다. */
const SYNTHETIC_DOMAIN = 'test.invalid';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

class FixtureError extends Error {}

export function fail(message) {
  throw new FixtureError(message);
}

/** loopback 주소만 허용한다. */
export function assertLocalUrl(rawUrl, label) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail(`${label} 값이 URL 형식이 아닙니다.`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    fail(
      `${label}의 호스트가 loopback이 아닙니다. 인증 E2E 픽스처는 로컬 테스트 인스턴스에서만 실행합니다.`,
    );
  }
  return url;
}

export function readFixtureEnv(env = process.env) {
  if (env.NODE_ENV === 'production') {
    fail('NODE_ENV=production에서는 픽스처를 실행하지 않습니다.');
  }

  const supabaseUrl =
    env.AUTH_TEST_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (supabaseUrl.trim() === '') {
    fail('AUTH_TEST_SUPABASE_URL 또는 NEXT_PUBLIC_SUPABASE_URL이 필요합니다.');
  }
  const url = assertLocalUrl(supabaseUrl.trim(), 'Supabase URL');

  const serviceRoleKey = (env.AUTH_TEST_SERVICE_ROLE_KEY ?? '').trim();
  if (serviceRoleKey === '') {
    fail(
      'AUTH_TEST_SERVICE_ROLE_KEY가 없습니다. 로컬 테스트 인스턴스의 키만 넣고, 값은 출력하지 않습니다.',
    );
  }

  const anonKey = (
    env.AUTH_TEST_ANON_KEY ??
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ''
  ).trim();

  const prefix = (env.AUTH_TEST_EMAIL_PREFIX ?? 'auth-e2e').trim() || 'auth-e2e';
  if (!/^[a-z0-9-]{1,32}$/.test(prefix)) {
    fail('AUTH_TEST_EMAIL_PREFIX는 소문자·숫자·하이픈 32자 이내여야 합니다.');
  }

  return {
    supabaseUrl: url.origin,
    serviceRoleKey,
    anonKey,
    prefix,
    dbContainer: (env.AUTH_TEST_DB_CONTAINER ?? '').trim(),
  };
}

/** 합성 계정 이메일. 실제로 도달할 수 없는 `.invalid` 도메인만 쓴다. */
export function syntheticEmail(prefix, key) {
  return `${prefix}-${key}@${SYNTHETIC_DOMAIN}`;
}

export function isSyntheticEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith(`@${SYNTHETIC_DOMAIN}`);
}

/** 실행할 때마다 새로 만드는 비밀번호. 저장은 Git 제외 경로에만 한다. */
export function generatePassword() {
  return `${randomBytes(24).toString('base64url')}Aa1!`;
}

export { FixtureError };
