import { describe, expect, it } from 'vitest';

import {
  authLinkFailurePath,
  buildAuthRedirectUrl,
  parseSafeNextPath,
  safeNextPath,
} from '@/features/auth/redirects';

describe('parseSafeNextPath', () => {
  it('앱이 가진 내부 경로는 그대로 통과한다', () => {
    expect(parseSafeNextPath('/')).toBe('/');
    expect(parseSafeNextPath('/settings')).toBe('/settings');
    expect(parseSafeNextPath('/memories?month=2026-09')).toBe('/memories?month=2026-09');
    expect(parseSafeNextPath('/wishes?status=planned')).toBe('/wishes?status=planned');
    expect(parseSafeNextPath('/calendar?month=2026-09&view=list')).toBe(
      '/calendar?month=2026-09&view=list',
    );
    expect(parseSafeNextPath('/onboarding')).toBe('/onboarding');
    expect(parseSafeNextPath('/reset-password')).toBe('/reset-password');
  });

  it('외부 주소를 거부한다', () => {
    expect(parseSafeNextPath('https://evil.example/steal')).toBeNull();
    expect(parseSafeNextPath('http://evil.example')).toBeNull();
    expect(parseSafeNextPath('//evil.example')).toBeNull();
    expect(parseSafeNextPath('/\\evil.example')).toBeNull();
    expect(parseSafeNextPath('\\\\evil.example')).toBeNull();
    expect(parseSafeNextPath('javascript:alert(1)')).toBeNull();
    expect(parseSafeNextPath('data:text/html,<script>')).toBeNull();
  });

  it('상대 경로와 빈 값을 거부한다', () => {
    expect(parseSafeNextPath('memories')).toBeNull();
    expect(parseSafeNextPath('')).toBeNull();
    expect(parseSafeNextPath('   ')).toBeNull();
    expect(parseSafeNextPath(undefined)).toBeNull();
    expect(parseSafeNextPath(null)).toBeNull();
    expect(parseSafeNextPath(42)).toBeNull();
  });

  it('제어 문자·개행이 섞인 값을 거부한다', () => {
    expect(parseSafeNextPath('/settings\n')).toBeNull();
    expect(parseSafeNextPath('/settings\r\nSet-Cookie: x=1')).toBeNull();
    expect(parseSafeNextPath('/set tings')).toBeNull();
    expect(parseSafeNextPath('/\u0000settings')).toBeNull();
  });

  it('허용 목록에 없는 경로를 거부한다', () => {
    expect(parseSafeNextPath('/auth/callback')).toBeNull();
    expect(parseSafeNextPath('/login')).toBeNull();
    expect(parseSafeNextPath('/api/secret')).toBeNull();
    expect(parseSafeNextPath('/demo')).toBeNull();
  });

  it('인코딩으로 우회하려는 경로도 내부 경로로만 해석한다', () => {
    // %2F%2F는 경로 문자로 남고 출처를 바꾸지 못한다. 허용 목록에도 없으므로 거부된다.
    expect(parseSafeNextPath('/%2F%2Fevil.example')).toBeNull();
  });

  it('fragment는 떼어 낸다 (초대 토큰이 따라다니지 않게)', () => {
    expect(parseSafeNextPath('/invite#token=abc')).toBe('/invite');
    expect(parseSafeNextPath('/settings?tab=1#anything')).toBe('/settings?tab=1');
  });

  it('safeNextPath는 실패 시 기본 경로를 준다', () => {
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath(undefined, '/settings')).toBe('/settings');
    expect(safeNextPath('/memories')).toBe('/memories');
  });
});

describe('authLinkFailurePath', () => {
  it('비밀번호 재설정 실패는 재설정 화면에서 안내한다', () => {
    expect(authLinkFailurePath('recovery')).toBe('/reset-password?authError=link');
  });

  it('그 밖의 확인 링크 실패는 로그인 화면에서 안내한다', () => {
    expect(authLinkFailurePath('email')).toBe('/login?authError=link');
    expect(authLinkFailurePath('not-a-type')).toBe('/login?authError=link');
    expect(authLinkFailurePath(null)).toBe('/login?authError=link');
    expect(authLinkFailurePath(undefined)).toBe('/login?authError=link');
  });

  it('내부 상대 경로만 돌려준다 (출처가 바뀌면 세션 쿠키가 사라진다)', () => {
    for (const type of ['recovery', 'email', null]) {
      const path = authLinkFailurePath(type);
      expect(path.startsWith('/')).toBe(true);
      expect(path.startsWith('//')).toBe(false);
    }
  });
});

describe('buildAuthRedirectUrl', () => {
  it('설정된 사이트 주소를 우선한다', () => {
    const url = buildAuthRedirectUrl({
      requestOrigin: 'http://localhost:3002',
      siteUrl: 'https://app.example',
      path: '/auth/callback',
      next: '/reset-password',
    });
    expect(url).toBe('https://app.example/auth/callback?next=%2Freset-password');
  });

  it('사이트 주소가 없으면 요청 출처를 쓴다', () => {
    const url = buildAuthRedirectUrl({
      requestOrigin: 'http://localhost:3002',
      siteUrl: undefined,
      path: '/auth/callback',
      next: '/',
    });
    expect(url).toBe('http://localhost:3002/auth/callback?next=%2F');
  });

  it('돌아갈 경로가 안전하지 않으면 붙이지 않는다', () => {
    const url = buildAuthRedirectUrl({
      requestOrigin: 'http://localhost:3002',
      siteUrl: undefined,
      path: '/auth/callback',
      next: 'https://evil.example',
    });
    expect(url).toBe('http://localhost:3002/auth/callback');
  });

  it('잘못된 사이트 주소는 무시하고 요청 출처로 되돌아간다', () => {
    const url = buildAuthRedirectUrl({
      requestOrigin: 'http://localhost:3002',
      siteUrl: 'javascript:alert(1)',
      path: '/auth/callback',
      next: undefined,
    });
    expect(url).toBe('http://localhost:3002/auth/callback');
  });

  it('출처를 전혀 확인할 수 없으면 실패한다', () => {
    expect(() =>
      buildAuthRedirectUrl({ requestOrigin: '', siteUrl: undefined, path: '/auth/callback' }),
    ).toThrow('INVALID_ORIGIN');
  });
});
