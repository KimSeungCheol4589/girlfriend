import { z } from 'zod';

import { compareCalendarDates, isCalendarDate, todayInSeoul } from '@/lib/dates';

import { ALLOWED_MAP_HOSTS, RESTAURANT_LIMITS, RESTAURANT_STATUSES } from './constants';

/**
 * 맛집·후기 입력 검증.
 *
 * 화면과 Server Action이 같은 규칙을 쓴다. DB 함수가 같은 제한을 다시 검사하므로
 * 여기서의 검증은 "먼저 걸러 주는 안내"이고 최종 방어는 DB다(CONTRACTS.md 4).
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
// 지도 링크
// ---------------------------------------------------------------------------

export type MapUrlProblem = 'https_required' | 'length' | 'host_not_allowed';

export type MapUrlCheck = { ok: true; url: string | null } | { ok: false; reason: MapUrlProblem };

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
 * 지도 링크 검사. 빈 값은 "링크 없음"(null)이다.
 *
 * DB 규칙(HTTPS·공백 없음·11~500자·허용 호스트)을 그대로 따르고,
 * 브라우저 URL 해석 결과도 같은 호스트를 가리키는지 한 번 더 확인한다.
 * 링크 내용을 가져오지 않는다(DESIGN 9).
 */
export function checkMapUrl(
  raw: string | null | undefined,
  allowedHosts: readonly string[] = ALLOWED_MAP_HOSTS,
): MapUrlCheck {
  const value = (raw ?? '').trim();
  if (value === '') return { ok: true, url: null };

  // DB 정규식 '^https://[^[:space:]]+$'는 대소문자를 구분한다.
  if (!/^https:\/\/\S+$/.test(value)) return { ok: false, reason: 'https_required' };

  const length = codePointLength(value);
  if (length < RESTAURANT_LIMITS.mapUrlMin || length > RESTAURANT_LIMITS.mapUrlMax) {
    return { ok: false, reason: 'length' };
  }

  const host = dbStyleUrlHost(value);
  if (host === null || !allowedHosts.includes(host)) {
    return { ok: false, reason: 'host_not_allowed' };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'https_required' };
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.hostname !== host
  ) {
    return { ok: false, reason: 'host_not_allowed' };
  }

  return { ok: true, url: value };
}

/** 화면에 링크로 그려도 되는 주소만 돌려준다. 저장된 값이라도 규칙을 벗어나면 링크로 만들지 않는다. */
export function safeMapHref(stored: string | null | undefined): string | null {
  const result = checkMapUrl(stored);
  return result.ok ? result.url : null;
}

export const MAP_URL_MESSAGES: Record<MapUrlProblem, string> = {
  https_required: '지도 링크는 https://로 시작하는 주소만 쓸 수 있어요.',
  length: `지도 링크는 ${RESTAURANT_LIMITS.mapUrlMin}~${RESTAURANT_LIMITS.mapUrlMax}자여야 해요.`,
  host_not_allowed: '네이버 지도·카카오맵 공유 링크만 저장할 수 있어요.',
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
const versionField = z
  .number()
  .int()
  .min(0)
  .max(2_147_483_647);

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
// 맛집 정보
// ---------------------------------------------------------------------------

export const restaurantInfoSchema = z.object({
  name: textField('이름', RESTAURANT_LIMITS.nameMax, { required: true }),
  area: textField('지역', RESTAURANT_LIMITS.areaMax),
  category: textField('음식 종류', RESTAURANT_LIMITS.categoryMax),
  mapUrl: z
    .string()
    .transform((value, context) => {
      const result = checkMapUrl(value);
      if (!result.ok) {
        context.addIssue({ code: 'custom', message: MAP_URL_MESSAGES[result.reason] });
        return z.NEVER;
      }
      return result.url;
    }),
  memo: textField('메모', RESTAURANT_LIMITS.memoMax),
});

export type RestaurantInfoInput = z.input<typeof restaurantInfoSchema>;
export type RestaurantInfo = z.output<typeof restaurantInfoSchema>;

export const saveRestaurantSchema = restaurantInfoSchema.extend({
  /** 새로 만들 때는 null. */
  restaurantId: uuidField.nullable(),
  expectedVersion: versionField,
});

export type SaveRestaurantInput = z.input<typeof saveRestaurantSchema>;

// ---------------------------------------------------------------------------
// 방문 상태
// ---------------------------------------------------------------------------

/** 방문일은 한국 달력 기준 오늘까지만 허용한다(DESIGN 5.3). */
export function visitedDateProblem(value: string, today: string = todayInSeoul()): string | null {
  if (!isCalendarDate(value)) return '방문한 날짜를 골라 주세요.';
  if (compareCalendarDates(value, today) > 0) return '방문일은 오늘보다 뒤일 수 없어요.';
  return null;
}

export const setStatusSchema = z
  .object({
    restaurantId: uuidField,
    status: z.enum(RESTAURANT_STATUSES, { message: '방문 상태를 다시 골라 주세요.' }),
    /** visited일 때만 쓴다. wishlist면 반드시 null이다. */
    visitedDate: z.string().nullable(),
    confirmDeleteReviews: z.boolean(),
    expectedVersion: versionField.min(1),
  })
  .superRefine((value, context) => {
    if (value.status === 'visited') {
      const problem = visitedDateProblem(value.visitedDate ?? '');
      if (problem) context.addIssue({ code: 'custom', path: ['visitedDate'], message: problem });
    } else if (value.visitedDate !== null) {
      context.addIssue({
        code: 'custom',
        path: ['visitedDate'],
        message: '가고 싶은 곳으로 돌릴 때는 방문일을 비워야 해요.',
      });
    }
  });

export type SetStatusInput = z.input<typeof setStatusSchema>;

export const deleteRestaurantSchema = z.object({
  restaurantId: uuidField,
  confirmDeleteReviews: z.boolean(),
  expectedVersion: versionField.min(1),
});

export type DeleteRestaurantInput = z.input<typeof deleteRestaurantSchema>;

// ---------------------------------------------------------------------------
// 개인 후기
// ---------------------------------------------------------------------------

export const saveReviewSchema = z.object({
  restaurantId: uuidField,
  rating: z
    .number({ message: '별점을 골라 주세요.' })
    .int('별점을 골라 주세요.')
    .min(RESTAURANT_LIMITS.ratingMin, '별점을 골라 주세요.')
    .max(RESTAURANT_LIMITS.ratingMax, '별점은 5점까지예요.'),
  comment: textField('한 줄 후기', RESTAURANT_LIMITS.reviewCommentMax),
  /** 후기가 없으면 0, 있으면 읽어 온 버전(DESIGN 7). */
  expectedVersion: versionField,
});

export type SaveReviewInput = z.input<typeof saveReviewSchema>;

export const deleteReviewSchema = z.object({
  reviewId: uuidField,
  expectedVersion: versionField.min(1),
});

export type DeleteReviewInput = z.input<typeof deleteReviewSchema>;
