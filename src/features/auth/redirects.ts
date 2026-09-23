/**
 * 열린 리다이렉트 방지.
 *
 * 로그인·인증 콜백은 "돌아갈 곳"을 입력으로 받는다. 이 값을 그대로 쓰면
 * `https://evil.example` 같은 외부 주소로 보낼 수 있다. 다음 규칙만 통과시킨다.
 *
 *   1. 같은 출처의 절대 경로(`/`로 시작)여야 한다.
 *   2. `//`, `/\` 로 시작하는 프로토콜 상대 주소는 거부한다.
 *   3. 제어 문자·개행·공백이 들어 있으면 거부한다.
 *   4. 앱이 실제로 가진 첫 경로 조각만 허용한다(허용 목록).
 *   5. fragment(`#...`)는 버린다. 초대 토큰이 실려 돌아다니지 않게 한다.
 */

/** 로그인 후 돌아갈 수 있는 화면의 첫 경로 조각. */
export const ALLOWED_REDIRECT_ROOTS = [
  '/',
  '/memories',
  '/restaurants',
  '/wishes',
  '/customize',
  '/settings',
  '/onboarding',
  '/invite',
  // 재설정 메일의 콜백이 돌아온 뒤 새 비밀번호 화면으로 보낸다.
  '/reset-password',
] as const;

export const DEFAULT_REDIRECT = '/';

const CONTROL_OR_SPACE = /[\u0000-\u001F\u007F\s]/;

/** 내부 경로로 안전하게 쓸 수 있는 값이면 정규화해서 돌려주고, 아니면 null. */
export function parseSafeNextPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  // 공백·제어 문자는 다듬지 않고 거부한다. 다듬어서 통과시키면 "무엇이 들어왔는지"와
  // "무엇으로 이동했는지"가 달라져 판단이 어려워진다.
  const value = raw;
  if (value.length === 0) return null;
  if (CONTROL_OR_SPACE.test(value)) return null;
  if (!value.startsWith('/')) return null;
  // 프로토콜 상대 주소(`//host`, `/\host`)는 브라우저가 외부 출처로 해석한다.
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  if (value.includes('\\')) return null;

  let url: URL;
  try {
    url = new URL(value, 'http://redirect.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'http://redirect.invalid') return null;

  const pathname = url.pathname;
  const root = `/${pathname.split('/')[1] ?? ''}`;
  const allowed = (ALLOWED_REDIRECT_ROOTS as readonly string[]).includes(
    pathname === '/' ? '/' : root,
  );
  if (!allowed) return null;

  // fragment는 버린다. 검색 매개변수는 그대로 유지한다(목록 필터 등).
  return `${pathname}${url.search}`;
}

/** 검증에 실패하면 기본 화면으로 보낸다. */
export function safeNextPath(raw: unknown, fallback: string = DEFAULT_REDIRECT): string {
  return parseSafeNextPath(raw) ?? fallback;
}

/**
 * 인증 링크(메일 확인·비밀번호 재설정)가 실패했을 때 돌아갈 내부 경로.
 *
 * 비밀번호 재설정은 재설정 화면에서, 그 밖의 확인 링크는 로그인 화면에서 안내한다.
 * 실패 사유는 쿼리에 자세히 싣지 않는다(토큰·계정 상태를 추측할 수 없게).
 */
export function authLinkFailurePath(type: string | null | undefined): string {
  return type === 'recovery' ? '/reset-password?authError=link' : '/login?authError=link';
}

/**
 * 인증 메일 링크가 돌아올 절대 주소.
 *
 * `NEXT_PUBLIC_SITE_URL`이 있으면 그 값을 쓰고, 없으면 요청 출처를 쓴다.
 * 요청 출처를 쓸 때도 최종 이동 경로는 `safeNextPath`로 제한한다.
 */
export function buildAuthRedirectUrl(input: {
  requestOrigin: string;
  siteUrl?: string | undefined;
  path: string;
  next?: string | undefined;
}): string {
  const base = normalizeOrigin(input.siteUrl) ?? normalizeOrigin(input.requestOrigin);
  if (!base) throw new Error('INVALID_ORIGIN');

  const url = new URL(input.path, base);
  const next = parseSafeNextPath(input.next);
  if (next) url.searchParams.set('next', next);
  return url.toString();
}

/**
 * 앱이 스스로를 가리킬 때 쓰는 출처.
 * 설정한 사이트 주소를 우선하고, 없거나 형식이 틀리면 요청 출처를 쓴다.
 */
export function resolveAppOrigin(
  siteUrl: string | undefined,
  requestOrigin: string,
): string | null {
  return normalizeOrigin(siteUrl) ?? normalizeOrigin(requestOrigin);
}

function normalizeOrigin(value: string | undefined | null): string | null {
  const raw = (value ?? '').trim();
  if (raw.length === 0) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}
