/**
 * Supabase 공개 설정 읽기와 검증.
 *
 * 규칙(DESIGN.md 11):
 *   - 브라우저에는 공개용 URL·키만 전달한다. 관리자 키는 이 경로에 존재하지 않는다.
 *   - 설정이 없으면 "로그인된 것처럼" 동작하지 않고 설정 필요 상태로 분명히 실패한다.
 *
 * `process.env.NEXT_PUBLIC_*`는 빌드 시 문자열로 치환되므로 반드시 리터럴로 읽는다.
 * 계산 로직은 순수 함수(`parseSupabaseConfig`)로 분리해 단위 테스트한다.
 */

export type SupabaseConfigIssue = 'missing' | 'placeholder' | 'invalid';

export type SupabaseConfigProblem = {
  /** 사용자가 설정 파일에서 찾아야 하는 이름. 값은 담지 않는다. */
  variable: string;
  issue: SupabaseConfigIssue;
};

export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export type SupabaseConfigResult =
  | { ok: true; config: SupabasePublicConfig }
  | { ok: false; problems: SupabaseConfigProblem[] };

export const SUPABASE_URL_VARIABLE = 'NEXT_PUBLIC_SUPABASE_URL';
export const SUPABASE_KEY_VARIABLE = 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY';

/** `.env.example`의 자리표시자를 실제 값으로 오인하지 않는다. */
function isPlaceholder(value: string): boolean {
  return /^replace[_-]?with/i.test(value) || /^replace_me$/i.test(value) || /^your[_-]/i.test(value);
}

function classify(raw: string | undefined): { value: string } | { issue: SupabaseConfigIssue } {
  const value = (raw ?? '').trim();
  if (value.length === 0) return { issue: 'missing' };
  if (isPlaceholder(value)) return { issue: 'placeholder' };
  return { value };
}

/**
 * 순수 검증. 입력은 이미 읽어 온 환경 변수 값이다.
 * `anonKey`는 구버전 이름(`NEXT_PUBLIC_SUPABASE_ANON_KEY`)을 위한 대체 입력이다.
 */
export function parseSupabaseConfig(input: {
  url?: string;
  publishableKey?: string;
  anonKey?: string;
}): SupabaseConfigResult {
  const problems: SupabaseConfigProblem[] = [];

  const url = classify(input.url);
  let parsedUrl: string | null = null;
  if ('issue' in url) {
    problems.push({ variable: SUPABASE_URL_VARIABLE, issue: url.issue });
  } else {
    try {
      const parsed = new URL(url.value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        problems.push({ variable: SUPABASE_URL_VARIABLE, issue: 'invalid' });
      } else {
        // 끝의 '/'는 supabase-js가 경로를 이어 붙일 때 이중 슬래시를 만든다.
        parsedUrl = url.value.replace(/\/+$/, '');
      }
    } catch {
      problems.push({ variable: SUPABASE_URL_VARIABLE, issue: 'invalid' });
    }
  }

  // 새 이름을 우선하고, 없으면 구 anon 키 이름을 읽는다.
  const primary = classify(input.publishableKey);
  const fallback = classify(input.anonKey);
  const chosen = 'value' in primary ? primary : fallback;

  let parsedKey: string | null = null;
  if ('issue' in chosen) {
    // 두 이름 모두 비어 있으면 'missing', 값이 있는데 자리표시자면 그대로 알린다.
    const issue = 'issue' in primary && 'issue' in fallback ? primary.issue : chosen.issue;
    problems.push({ variable: SUPABASE_KEY_VARIABLE, issue });
  } else if (/\s/.test(chosen.value) || chosen.value.length < 20) {
    problems.push({ variable: SUPABASE_KEY_VARIABLE, issue: 'invalid' });
  } else {
    parsedKey = chosen.value;
  }

  if (parsedUrl === null || parsedKey === null) {
    return { ok: false, problems };
  }
  return { ok: true, config: { url: parsedUrl, publishableKey: parsedKey } };
}

/** 빌드 시 치환되도록 리터럴로 읽는다. */
export function readSupabaseConfig(): SupabaseConfigResult {
  return parseSupabaseConfig({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseConfig().ok;
}

/** 설정이 없을 때 던지는 오류. 화면은 이 오류를 잡아 "설정 필요"로 안내한다. */
export class SupabaseConfigError extends Error {
  readonly problems: SupabaseConfigProblem[];

  constructor(problems: SupabaseConfigProblem[]) {
    super('SUPABASE_NOT_CONFIGURED');
    this.name = 'SupabaseConfigError';
    this.problems = problems;
  }
}

export function requireSupabaseConfig(): SupabasePublicConfig {
  const result = readSupabaseConfig();
  if (!result.ok) throw new SupabaseConfigError(result.problems);
  return result.config;
}

export function isSupabaseConfigError(error: unknown): error is SupabaseConfigError {
  return error instanceof SupabaseConfigError;
}
