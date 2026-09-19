import { describe, expect, it } from 'vitest';

import { buildWebServerEnv, isBlockedEnvKey } from '../auth/web-server-env';

/**
 * 앱 서버 프로세스에 테스트 관리자 키가 들어가지 않는지 고정한다.
 * 값 자체는 단언에 쓰지 않고 "비어 있는가"만 본다.
 */
const MARKER = 'marker-value-not-a-real-key';

describe('isBlockedEnvKey', () => {
  it('service_role이 들어간 이름을 막는다', () => {
    expect(isBlockedEnvKey('AUTH_TEST_SERVICE_ROLE_KEY')).toBe(true);
    expect(isBlockedEnvKey('SUPABASE_SERVICE_ROLE_KEY')).toBe(true);
    expect(isBlockedEnvKey('some_service_role_thing')).toBe(true);
  });

  it('앱이 실제로 써야 하는 이름은 막지 않는다', () => {
    expect(isBlockedEnvKey('NEXT_PUBLIC_SUPABASE_URL')).toBe(false);
    expect(isBlockedEnvKey('AUTH_TEST_ANON_KEY')).toBe(false);
    expect(isBlockedEnvKey('PATH')).toBe(false);
  });
});

describe('buildWebServerEnv', () => {
  it('관리자 키를 빈 값으로 덮어쓴다 (빠뜨리면 상속된다)', () => {
    const env = buildWebServerEnv({
      AUTH_TEST_SERVICE_ROLE_KEY: MARKER,
      SUPABASE_SERVICE_ROLE_KEY: MARKER,
      PATH: '/usr/bin',
    });

    expect(env.AUTH_TEST_SERVICE_ROLE_KEY).toBe('');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('');
    expect(Object.values(env).includes(MARKER)).toBe(false);
    expect(env.PATH).toBe('/usr/bin');
  });

  it('원본에 없어도 빈 값으로 존재하게 만든다', () => {
    const env = buildWebServerEnv({ PATH: '/usr/bin' });
    expect(env.AUTH_TEST_SERVICE_ROLE_KEY).toBe('');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('');
  });

  it('override로도 관리자 키를 되살리지 못한다', () => {
    const env = buildWebServerEnv({}, { AUTH_TEST_SERVICE_ROLE_KEY: MARKER });
    expect(env.AUTH_TEST_SERVICE_ROLE_KEY).toBe('');
  });

  it('앱에 필요한 값은 override로 덮어쓴다', () => {
    const env = buildWebServerEnv(
      { NEXT_PUBLIC_DEMO_MODE: 'true' },
      { NEXT_PUBLIC_DEMO_MODE: 'false', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56321' },
    );
    expect(env.NEXT_PUBLIC_DEMO_MODE).toBe('false');
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:56321');
  });

  it('문자열이 아닌 값은 넘기지 않는다', () => {
    const env = buildWebServerEnv({ EMPTY: undefined, KEEP: 'yes' });
    expect('EMPTY' in env).toBe(false);
    expect(env.KEEP).toBe('yes');
  });
});
