/**
 * DESIGN.md 5.2 / 9의 입력 제한을 한곳에 모은다.
 * 화면과 데모 검증은 이 값을 참조하고, 실제 서버·DB 구현도 같은 값을 따라야 한다.
 * 이 파일은 계약 상수만 담는다. 데모 상태나 더미 데이터를 넣지 않는다.
 */

export const SPACE_LIMITS = {
  nameMin: 1,
  nameMax: 30,
  introductionMax: 200,
} as const;

export const MEMORY_LIMITS = {
  titleMin: 1,
  titleMax: 80,
  bodyMax: 10_000,
  locationMax: 100,
  tagMax: 20,
  tagCountMax: 5,
  photoCountMax: 10,
  photoBytesMax: 10 * 1024 * 1024,
} as const;

export const RESTAURANT_LIMITS = {
  nameMin: 1,
  nameMax: 100,
  memoMax: 2_000,
  ratingMin: 1,
  ratingMax: 5,
  reviewCommentMax: 500,
} as const;

/** DESIGN.md 8.2: 브라우저에서 허용하는 입력 이미지 유형. HEIC는 MVP에서 안내와 함께 거부한다. */
export const ACCEPTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const REJECTED_IMAGE_MIME_TYPES = ['image/heic', 'image/heif'] as const;

/** DESIGN.md 1: 표시 기준 시간대. 날짜 차이는 달력 날짜로 계산한다. */
export const DISPLAY_TIME_ZONE = 'Asia/Seoul';

/** DESIGN.md 4.1: 테마 키 3종. */
export const THEME_KEYS = ['cream', 'rose', 'sage'] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

/** DESIGN.md 4.2: 홈 섹션 키. 각 키는 정확히 한 번 포함하고 순서와 표시 여부만 바꾼다. */
export const HOME_SECTION_KEYS = ['pinned', 'recentMemories', 'wishlist'] as const;
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

export const HOME_SECTION_LABELS: Record<HomeSectionKey, string> = {
  pinned: '홈에 고정한 추억',
  recentMemories: '최근 추억',
  wishlist: '다음에 가고 싶은 맛집',
};

/** DESIGN.md 4.2 기본값. */
export const DEFAULT_ACCENT_COLOR = '#8B435A';

/** DESIGN.md 3: 추억 목록 페이지 크기. */
export const MEMORY_PAGE_SIZE = 20;

/** DESIGN.md 7: 서버 작업 오류 코드. 데모 화면도 같은 코드 이름으로 실패를 표현한다. */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFLICT',
  'INVITE_INVALID',
  'SPACE_FULL',
  'UPLOAD_FAILED',
  'RETRYABLE_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
