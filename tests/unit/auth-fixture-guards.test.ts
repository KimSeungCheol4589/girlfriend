import { describe, expect, it } from 'vitest';

// 픽스처는 Node로 직접 실행하는 .mjs 모듈이다. 안전장치는 단위 테스트로 고정한다.
// @ts-expect-error -- 타입 선언이 없는 로컬 테스트 전용 모듈
import * as fixtureEnv from '../auth/fixtures/env.mjs';

const {
  ACCOUNT_KEYS,
  assertLocalUrl,
  generatePassword,
  isSyntheticEmail,
  readFixtureEnv,
  syntheticEmail,
} = fixtureEnv as {
  ACCOUNT_KEYS: readonly string[];
  assertLocalUrl: (url: string, label: string) => URL;
  generatePassword: () => string;
  isSyntheticEmail: (email: unknown) => boolean;
  readFixtureEnv: (env: Record<string, string | undefined>) => {
    supabaseUrl: string;
    prefix: string;
    dbContainer: string;
  };
  syntheticEmail: (prefix: string, key: string) => string;
};

const LOCAL_ENV = {
  AUTH_TEST_SUPABASE_URL: 'http://127.0.0.1:56321',
  AUTH_TEST_SERVICE_ROLE_KEY: 'local-service-role-key-placeholder',
};

describe('픽스처 안전장치', () => {
  it('계정 A~D를 다룬다', () => {
    expect([...ACCOUNT_KEYS]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('loopback 주소만 허용한다', () => {
    expect(assertLocalUrl('http://127.0.0.1:56321', 'x').hostname).toBe('127.0.0.1');
    expect(assertLocalUrl('http://localhost:56321', 'x').hostname).toBe('localhost');

    expect(() => assertLocalUrl('https://example.supabase.co', 'x')).toThrow(/loopback/);
    expect(() => assertLocalUrl('http://10.0.0.5:8000', 'x')).toThrow(/loopback/);
    expect(() => assertLocalUrl('not-a-url', 'x')).toThrow();
  });

  it('원격 주소가 들어오면 환경 읽기 단계에서 멈춘다', () => {
    expect(() =>
      readFixtureEnv({ ...LOCAL_ENV, AUTH_TEST_SUPABASE_URL: 'https://example.supabase.co' }),
    ).toThrow(/loopback/);
  });

  it('production에서는 실행하지 않는다', () => {
    expect(() => readFixtureEnv({ ...LOCAL_ENV, NODE_ENV: 'production' })).toThrow(/production/);
  });

  it('관리자 키가 없으면 멈춘다', () => {
    expect(() =>
      readFixtureEnv({ AUTH_TEST_SUPABASE_URL: LOCAL_ENV.AUTH_TEST_SUPABASE_URL }),
    ).toThrow(/AUTH_TEST_SERVICE_ROLE_KEY/);
  });

  it('접두사 형식을 제한한다', () => {
    expect(readFixtureEnv({ ...LOCAL_ENV }).prefix).toBe('auth-e2e');
    expect(readFixtureEnv({ ...LOCAL_ENV, AUTH_TEST_EMAIL_PREFIX: 'e2e-2' }).prefix).toBe('e2e-2');
    expect(() => readFixtureEnv({ ...LOCAL_ENV, AUTH_TEST_EMAIL_PREFIX: 'bad prefix' })).toThrow();
    expect(() => readFixtureEnv({ ...LOCAL_ENV, AUTH_TEST_EMAIL_PREFIX: 'UPPER' })).toThrow();
  });

  it('합성 계정 도메인은 .invalid로 고정된다', () => {
    const email = syntheticEmail('auth-e2e', 'a');
    expect(email).toBe('auth-e2e-a@test.invalid');
    expect(isSyntheticEmail(email)).toBe(true);
    expect(isSyntheticEmail('someone@example.com')).toBe(false);
    expect(isSyntheticEmail('someone@test.invalid.example.com')).toBe(false);
  });

  it('비밀번호는 매번 새로 만들고 충분히 길다', () => {
    const first = generatePassword();
    const second = generatePassword();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(16);
  });
});
