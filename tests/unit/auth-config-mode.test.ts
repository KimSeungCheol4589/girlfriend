import { describe, expect, it } from 'vitest';

import { resolveAppMode } from '@/features/auth/mode';
import { parseSupabaseConfig } from '@/lib/supabase/config';

const KEY = 'sb_publishable_0123456789abcdefghij';

describe('parseSupabaseConfig', () => {
  it('URL과 키가 모두 있으면 통과한다', () => {
    const result = parseSupabaseConfig({ url: 'http://127.0.0.1:56321', publishableKey: KEY });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.url).toBe('http://127.0.0.1:56321');
      expect(result.config.publishableKey).toBe(KEY);
    }
  });

  it('구 anon 키 이름도 읽는다', () => {
    const result = parseSupabaseConfig({ url: 'https://x.supabase.co', anonKey: KEY });
    expect(result.ok).toBe(true);
  });

  it('끝의 슬래시를 정리한다', () => {
    const result = parseSupabaseConfig({ url: 'https://x.supabase.co//', publishableKey: KEY });
    expect(result.ok && result.config.url).toBe('https://x.supabase.co');
  });

  it('값이 없으면 어떤 이름이 비었는지 알려 준다', () => {
    const result = parseSupabaseConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.map((problem) => problem.issue)).toEqual(['missing', 'missing']);
      expect(result.problems[0]?.variable).toBe('NEXT_PUBLIC_SUPABASE_URL');
    }
  });

  it('.env.example의 자리표시자를 실제 값으로 보지 않는다', () => {
    const result = parseSupabaseConfig({
      url: 'REPLACE_WITH_SUPABASE_URL',
      publishableKey: 'REPLACE_WITH_PUBLISHABLE_OR_ANON_KEY',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.every((problem) => problem.issue === 'placeholder')).toBe(true);
    }
  });

  it('형식이 잘못된 값을 거부한다', () => {
    expect(parseSupabaseConfig({ url: 'not-a-url', publishableKey: KEY }).ok).toBe(false);
    expect(parseSupabaseConfig({ url: 'ftp://x.example', publishableKey: KEY }).ok).toBe(false);
    expect(parseSupabaseConfig({ url: 'https://x.supabase.co', publishableKey: 'short' }).ok).toBe(
      false,
    );
  });

  it('문제 보고에 값 자체를 담지 않는다', () => {
    const result = parseSupabaseConfig({ url: 'https://leak.example', publishableKey: 'short-key' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result.problems)).not.toContain('short-key');
      expect(JSON.stringify(result.problems)).not.toContain('leak.example');
    }
  });
});

describe('resolveAppMode', () => {
  it('설정이 있으면 실제 모드다', () => {
    expect(resolveAppMode({ configured: true, demoFlag: undefined })).toBe('live');
    expect(resolveAppMode({ configured: true, demoFlag: 'false' })).toBe('live');
  });

  it('데모는 명시적으로 켰을 때만 동작한다', () => {
    expect(resolveAppMode({ configured: true, demoFlag: 'true' })).toBe('demo');
    expect(resolveAppMode({ configured: false, demoFlag: 'TRUE' })).toBe('demo');
    expect(resolveAppMode({ configured: false, demoFlag: ' 1 ' })).toBe('demo');
  });

  it('설정이 없으면 데모로 흘러가지 않고 설정 필요 상태가 된다', () => {
    // 설정 누락이 조용히 데모로 대체되면 "동작하는 것처럼" 보인다. 그렇게 하지 않는다.
    expect(resolveAppMode({ configured: false, demoFlag: undefined })).toBe('unconfigured');
    expect(resolveAppMode({ configured: false, demoFlag: '' })).toBe('unconfigured');
    expect(resolveAppMode({ configured: false, demoFlag: 'false' })).toBe('unconfigured');
    expect(resolveAppMode({ configured: false, demoFlag: '0' })).toBe('unconfigured');
    expect(resolveAppMode({ configured: false, demoFlag: 'yes' })).toBe('unconfigured');
  });

  it('설정이 있으면 데모를 켜지 않는 한 실제 모드다', () => {
    expect(resolveAppMode({ configured: true, demoFlag: 'false' })).toBe('live');
    expect(resolveAppMode({ configured: true, demoFlag: 'anything-else' })).toBe('live');
  });
});
