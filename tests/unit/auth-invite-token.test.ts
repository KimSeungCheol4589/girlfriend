import { describe, expect, it } from 'vitest';

import {
  INVITE_TOKEN_STORAGE_KEY,
  INVITE_TOKEN_TTL_MS,
  buildInviteLink,
  clearInviteToken,
  isInviteTokenShape,
  parseInviteTokenFromHash,
  parseStoredToken,
  recallInviteToken,
  rememberInviteToken,
  serializeStoredToken,
  type TokenStorageLike,
} from '@/features/auth/invite-token';

const TOKEN = 'a'.repeat(43);

function fakeStorage(initial: Record<string, string> = {}): TokenStorageLike & {
  data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

describe('isInviteTokenShape', () => {
  it('충분히 긴 URL 안전 문자열만 받는다', () => {
    expect(isInviteTokenShape(TOKEN)).toBe(true);
    expect(isInviteTokenShape('short')).toBe(false);
    expect(isInviteTokenShape(`${TOKEN}<script>`)).toBe(false);
    expect(isInviteTokenShape(undefined)).toBe(false);
  });
});

describe('parseInviteTokenFromHash', () => {
  it('fragment에서 토큰을 읽는다', () => {
    expect(parseInviteTokenFromHash(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(parseInviteTokenFromHash(`#invite=${TOKEN}`)).toBe(TOKEN);
    expect(parseInviteTokenFromHash(`token=${TOKEN}`)).toBe(TOKEN);
  });

  it('형식이 아니거나 없으면 null이다', () => {
    expect(parseInviteTokenFromHash('#token=short')).toBeNull();
    expect(parseInviteTokenFromHash('#other=value')).toBeNull();
    expect(parseInviteTokenFromHash('#')).toBeNull();
    expect(parseInviteTokenFromHash('')).toBeNull();
    expect(parseInviteTokenFromHash(null)).toBeNull();
  });
});

describe('buildInviteLink', () => {
  it('토큰을 fragment에만 넣는다 (쿼리 금지)', () => {
    const link = buildInviteLink('https://app.example', TOKEN);
    expect(link).toBe(`https://app.example/invite#token=${TOKEN}`);

    const url = new URL(link);
    expect(url.search).toBe('');
    expect(url.hash).toContain(TOKEN);
  });
});

describe('탭 보관', () => {
  it('보관한 토큰을 다시 읽는다', () => {
    const storage = fakeStorage();
    const now = 1_000_000;

    expect(rememberInviteToken(storage, TOKEN, now)).toBe(true);
    expect(storage.data[INVITE_TOKEN_STORAGE_KEY]).toBeTruthy();
    expect(recallInviteToken(storage, now + 1000)).toBe(TOKEN);
  });

  it('보관 시간이 지나면 읽지 않고 지운다', () => {
    const storage = fakeStorage();
    const now = 1_000_000;
    rememberInviteToken(storage, TOKEN, now);

    expect(recallInviteToken(storage, now + INVITE_TOKEN_TTL_MS + 1)).toBeNull();
    expect(storage.data[INVITE_TOKEN_STORAGE_KEY]).toBeUndefined();
  });

  it('손상된 값은 읽지 않고 지운다', () => {
    const storage = fakeStorage({ [INVITE_TOKEN_STORAGE_KEY]: 'not-json' });
    expect(recallInviteToken(storage, Date.now())).toBeNull();
    expect(storage.data[INVITE_TOKEN_STORAGE_KEY]).toBeUndefined();
  });

  it('형식이 아닌 토큰은 보관하지 않는다', () => {
    const storage = fakeStorage();
    expect(rememberInviteToken(storage, 'short', Date.now())).toBe(false);
    expect(storage.data[INVITE_TOKEN_STORAGE_KEY]).toBeUndefined();
  });

  it('미래 시각으로 위조된 값은 믿지 않는다', () => {
    const now = 1_000_000;
    const raw = serializeStoredToken(TOKEN, now + 10 * 60_000);
    expect(parseStoredToken(raw, now)).toBeNull();
  });

  it('지우면 흔적이 남지 않는다', () => {
    const storage = fakeStorage();
    rememberInviteToken(storage, TOKEN, Date.now());
    clearInviteToken(storage);
    expect(storage.data[INVITE_TOKEN_STORAGE_KEY]).toBeUndefined();
    expect(JSON.stringify(storage.data)).not.toContain(TOKEN);
  });

  it('저장소가 없으면 조용히 실패한다', () => {
    expect(rememberInviteToken(null, TOKEN, Date.now())).toBe(false);
    expect(recallInviteToken(null, Date.now())).toBeNull();
    expect(() => clearInviteToken(null)).not.toThrow();
  });

  it('저장소가 예외를 던져도 앱을 멈추지 않는다', () => {
    const broken: TokenStorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };

    expect(rememberInviteToken(broken, TOKEN, Date.now())).toBe(false);
    expect(recallInviteToken(broken, Date.now())).toBeNull();
    expect(() => clearInviteToken(broken)).not.toThrow();
  });
});
