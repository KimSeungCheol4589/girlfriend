/**
 * 초대 토큰 취급 규칙 (DESIGN.md 8.1).
 *
 *   - 토큰은 URL **fragment**로만 전달한다. 쿼리 문자열에 넣으면 서버 로그·리퍼러에 남는다.
 *   - 읽는 즉시 주소에서 지운다.
 *   - 로그인을 거쳐야 할 수 있으므로 **그 탭에서만** 짧은 시간 보관한다(sessionStorage).
 *   - 수락 성공·만료·로그아웃 시 지운다.
 *   - 어떤 경우에도 로그·오류 보고·서버 요청 쿼리에 남기지 않는다.
 */

export const INVITE_TOKEN_STORAGE_KEY = 'gf.invite.token';
/** 로그인 과정을 지나기에 충분하되 길지 않은 보관 시간. */
export const INVITE_TOKEN_TTL_MS = 10 * 60 * 1000;

/** DB는 32자 미만 토큰을 무효로 본다(accept_invite). 형식이 다른 값은 저장하지 않는다. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,512}$/;

export function isInviteTokenShape(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** `#token=...` 또는 `#invite=...` 형식의 fragment에서 토큰만 꺼낸다. */
export function parseInviteTokenFromHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw.length === 0) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }

  const candidate = params.get('token') ?? params.get('invite');
  if (candidate && isInviteTokenShape(candidate)) return candidate;
  return null;
}

/** 초대 링크 만들기. 토큰은 fragment에만 넣는다. */
export function buildInviteLink(origin: string, token: string): string {
  const url = new URL('/invite', origin);
  url.hash = `token=${token}`;
  return url.toString();
}

export type StoredInviteToken = { token: string; storedAt: number };

export type TokenStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function serializeStoredToken(token: string, now: number): string {
  return JSON.stringify({ token, storedAt: now } satisfies StoredInviteToken);
}

/** 보관된 값에서 아직 유효한 토큰만 돌려준다. 만료·형식 불일치는 null이다. */
export function parseStoredToken(raw: string | null, now: number): string | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;

  const { token, storedAt } = parsed as Partial<StoredInviteToken>;
  if (!isInviteTokenShape(token)) return null;
  if (typeof storedAt !== 'number' || !Number.isFinite(storedAt)) return null;
  if (now - storedAt > INVITE_TOKEN_TTL_MS) return null;
  if (storedAt > now + 60_000) return null; // 시계가 크게 어긋난 값은 믿지 않는다.
  return token;
}

export function rememberInviteToken(
  storage: TokenStorageLike | null,
  token: string,
  now: number,
): boolean {
  if (!storage || !isInviteTokenShape(token)) return false;
  try {
    storage.setItem(INVITE_TOKEN_STORAGE_KEY, serializeStoredToken(token, now));
    return true;
  } catch {
    return false;
  }
}

export function recallInviteToken(storage: TokenStorageLike | null, now: number): string | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(INVITE_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
  const token = parseStoredToken(raw, now);
  // 만료·손상된 값은 즉시 지운다.
  if (!token && raw !== null) clearInviteToken(storage);
  return token;
}

export function clearInviteToken(storage: TokenStorageLike | null): void {
  if (!storage) return;
  try {
    storage.removeItem(INVITE_TOKEN_STORAGE_KEY);
  } catch {
    // 저장소를 쓸 수 없는 브라우저. 보관 자체가 없었으므로 무시한다.
  }
}

/** 브라우저에서만 쓰는 헬퍼. 서버 렌더 중에는 null이다. */
export function getTabStorage(): TokenStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
