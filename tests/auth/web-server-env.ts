/**
 * 인증 E2E가 띄우는 앱 서버에 넘길 환경 변수를 만든다.
 *
 * 핵심 규칙: **테스트 전용 관리자 키(service_role)는 앱 서버 프로세스로 넘기지 않는다.**
 *
 * Playwright의 `webServer.env`는 현재 프로세스 환경 위에 덧씌워지는 방식이라
 * "빼먹는 것"만으로는 상속을 막을 수 없다. 그래서 해당 키를 **빈 값으로 명시해** 덮어쓴다.
 * 러너(테스트 코드·픽스처)는 자기 프로세스 환경에서 계속 키를 읽을 수 있다.
 *
 * 앱 코드는 이 값을 읽지 않지만(참조 0건), "관리자 키는 앱·브라우저에 두지 않는다"는
 * 경계를 프로세스 수준에서도 지키기 위한 것이다(독립 검토 지적 3).
 */

/** 앱 서버로 넘기면 안 되는 키. 이름에 이 조각이 들어가면 모두 막는다. */
export const BLOCKED_ENV_PATTERN = /service_role/i;

/** 값이 비어 있어도 반드시 "빈 값"으로 덮어쓸 키(상속 차단용). */
export const ALWAYS_BLANKED_ENV_KEYS = ['AUTH_TEST_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

export function isBlockedEnvKey(key: string): boolean {
  return BLOCKED_ENV_PATTERN.test(key) || ALWAYS_BLANKED_ENV_KEYS.includes(key);
}

/**
 * 앱 서버용 환경을 만든다.
 *
 * - 문자열 값만 넘긴다.
 * - 막아야 할 키는 **빈 문자열**로 바꾼다(빠뜨리면 상속된다).
 * - `overrides`는 마지막에 덮어쓴다. 다만 막아야 할 키는 override로도 되살리지 않는다.
 */
export function buildWebServerEnv(
  source: Record<string, string | undefined>,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue;
    result[key] = isBlockedEnvKey(key) ? '' : value;
  }

  for (const [key, value] of Object.entries(overrides)) {
    result[key] = isBlockedEnvKey(key) ? '' : value;
  }

  // 원본에 없더라도 빈 값으로 존재하게 만들어, 어떤 경로로도 상속되지 않게 한다.
  for (const key of ALWAYS_BLANKED_ENV_KEYS) result[key] = '';

  return result;
}
