import { z } from 'zod';

import { isCalendarDate } from '@/lib/dates';

import { WISH_CATEGORIES, WISH_LIMITS, WISH_STATUSES } from './constants';

/**
 * 위시 입력 검증.
 *
 * 화면과 Server Action이 같은 규칙을 쓴다. DB 함수가 같은 제한을 다시 검사하므로
 * 여기서의 검증은 "먼저 걸러 주는 안내"이고 최종 방어는 DB다.
 *
 * 길이는 PostgreSQL `char_length`와 같게 **코드 포인트** 단위로 센다.
 * (자바스크립트 `length`는 UTF-16 단위라 이모지 하나를 2로 센다.)
 */

export function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

// ---------------------------------------------------------------------------
// 링크
// ---------------------------------------------------------------------------

export type LinkUrlProblem = 'https_required' | 'length' | 'host_not_allowed';

export type LinkUrlCheck = { ok: true; url: string | null } | { ok: false; reason: LinkUrlProblem };

/**
 * DB의 `app_private.url_host`와 같은 방식으로 호스트를 뽑는다.
 * `https://` 뒤에서 첫 `/`, `?`, `#` 앞까지를 소문자로 바꾼다(포트·사용자 정보가 있으면 그대로 남는다).
 */
export function dbStyleUrlHost(url: string): string | null {
  const rest = url.replace(/^https:\/\//, '');
  const host = (rest.split('/')[0] ?? '').split('?')[0]?.split('#')[0] ?? '';
  const lowered = host.toLowerCase();
  return lowered === '' ? null : lowered;
}

/**
 * 위시 링크 검사. 빈 값은 "링크 없음"(null)이다.
 *
 * 맛집 지도 링크와 달리 **호스트 허용 목록은 두지 않는다**. 어떤 사이트든 붙여 넣을 수 있다.
 * 대신 DB와 같은 규칙(HTTPS·공백 없음·11~500자)을 지키고, 사용자 정보가 붙은 주소
 * (`https://믿을만한곳@악성사이트/`)는 거부한다. 진짜 호스트를 가리는 데 쓰이기 때문이다.
 * 서버는 링크 내용을 가져오지 않는다(DESIGN 9).
 */
export function checkLinkUrl(raw: string | null | undefined): LinkUrlCheck {
  const value = (raw ?? '').trim();
  if (value === '') return { ok: true, url: null };

  // DB 정규식 '^https://[^[:space:]]+$'는 대소문자를 구분한다.
  if (!/^https:\/\/\S+$/.test(value)) return { ok: false, reason: 'https_required' };

  const length = codePointLength(value);
  if (length < WISH_LIMITS.linkUrlMin || length > WISH_LIMITS.linkUrlMax) {
    return { ok: false, reason: 'length' };
  }

  const host = dbStyleUrlHost(value);
  // DB도 같은 방식으로 호스트를 뽑아 `@`가 있으면 거부한다.
  if (host === null || host.includes('@')) return { ok: false, reason: 'host_not_allowed' };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'https_required' };
  }
  // 브라우저 해석 결과도 같은 호스트를 가리켜야 한다(포트는 그대로 허용한다).
  const parsedHost = parsed.port === '' ? parsed.hostname : `${parsed.hostname}:${parsed.port}`;
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsedHost !== host
  ) {
    return { ok: false, reason: 'host_not_allowed' };
  }

  return { ok: true, url: value };
}

/** 화면에 링크로 그려도 되는 주소만 돌려준다. 저장된 값이라도 규칙을 벗어나면 링크로 만들지 않는다. */
export function safeLinkHref(stored: string | null | undefined): string | null {
  const result = checkLinkUrl(stored);
  return result.ok ? result.url : null;
}

export const LINK_URL_MESSAGES: Record<LinkUrlProblem, string> = {
  https_required: '링크는 https://로 시작하는 주소만 쓸 수 있어요.',
  length: `링크는 ${WISH_LIMITS.linkUrlMin}~${WISH_LIMITS.linkUrlMax}자여야 해요.`,
  host_not_allowed: '주소를 확인해 주세요. 사이트 주소가 분명한 링크만 저장할 수 있어요.',
};

// ---------------------------------------------------------------------------
// 공통 필드
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

const uuidField = z.string().refine(isUuid, '대상을 찾을 수 없어요.');

/** 0 이상의 정수 버전. 새로 만들 때는 0이다(CONTRACTS.md 0). */
const versionField = z.number().int().min(0).max(2_147_483_647);

function textField(label: string, max: number, options: { required?: boolean } = {}) {
  return z
    .string()
    .transform((value) => value.trim())
    .refine((value) => !options.required || value.length > 0, `${label}을(를) 입력해 주세요.`)
    .refine(
      (value) => codePointLength(value) <= max,
      `${label}은(는) ${max.toLocaleString('ko-KR')}자까지 쓸 수 있어요.`,
    );
}

// ---------------------------------------------------------------------------
// 위시 정보 (생성·수정)
// ---------------------------------------------------------------------------

export const wishInfoSchema = z.object({
  title: textField('제목', WISH_LIMITS.titleMax, { required: true }),
  category: z.enum(WISH_CATEGORIES, { message: '분류를 다시 골라 주세요.' }),
  memo: textField('메모', WISH_LIMITS.memoMax),
  linkUrl: z.string().transform((value, context) => {
    const result = checkLinkUrl(value);
    if (!result.ok) {
      context.addIssue({ code: 'custom', message: LINK_URL_MESSAGES[result.reason] });
      return z.NEVER;
    }
    return result.url;
  }),
});

export type WishInfoInput = z.input<typeof wishInfoSchema>;
export type WishInfo = z.output<typeof wishInfoSchema>;

export const saveWishSchema = wishInfoSchema.extend({
  /** 새로 만들 때는 null. */
  wishId: uuidField.nullable(),
  expectedVersion: versionField,
});

export type SaveWishInput = z.input<typeof saveWishSchema>;

// ---------------------------------------------------------------------------
// 상태·계획일
// ---------------------------------------------------------------------------

/**
 * 계획일 검사.
 *
 * 맛집 방문일과 달리 **미래 날짜가 정상**이다(앞으로 할 일이므로). 달력 날짜 형식만 확인한다.
 */
export function plannedDateProblem(value: string): string | null {
  if (!isCalendarDate(value)) return '계획한 날짜를 올바르게 골라 주세요.';
  return null;
}

export const setWishStatusSchema = z
  .object({
    wishId: uuidField,
    status: z.enum(WISH_STATUSES, { message: '상태를 다시 골라 주세요.' }),
    /** 선택 값. `wish`로 되돌릴 때는 반드시 null이다. */
    plannedDate: z.string().nullable(),
    expectedVersion: versionField.min(1),
  })
  .superRefine((value, context) => {
    if (value.status === 'wish') {
      if (value.plannedDate !== null) {
        context.addIssue({
          code: 'custom',
          path: ['plannedDate'],
          message: '하고 싶음으로 되돌릴 때는 계획한 날짜를 비워야 해요.',
        });
      }
      return;
    }
    if (value.plannedDate === null) return;
    const problem = plannedDateProblem(value.plannedDate);
    if (problem) context.addIssue({ code: 'custom', path: ['plannedDate'], message: problem });
  });

export type SetWishStatusInput = z.input<typeof setWishStatusSchema>;

export const deleteWishSchema = z.object({
  wishId: uuidField,
  expectedVersion: versionField.min(1),
});

export type DeleteWishInput = z.input<typeof deleteWishSchema>;
