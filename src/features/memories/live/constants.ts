import { MEMORY_LIMITS, MEMORY_PAGE_SIZE } from '@/lib/contracts';

/**
 * 실제(live) 추억 기능의 계약 상수.
 *
 * 기준: DESIGN.md 3·8.2, docs/database/CONTRACTS.md 2·3·6.1.
 * 데모 화면은 이 파일을 쓰지 않는다(데모 저장소와 실제 저장을 섞지 않는다).
 */

/** `prepare_upload`가 돌려주는 비공개 버킷. 응답 값이 이와 다르면 업로드하지 않는다. */
export const MEMORY_BUCKET = 'space-assets';

/** DESIGN.md 3: 20개씩 더 보기. */
export const LIVE_MEMORY_PAGE_SIZE = MEMORY_PAGE_SIZE;

/** DESIGN.md 8.2: 브라우저·서버 재인코딩 모두 긴 변 최대 2,048px. */
export const MEMORY_PHOTO_MAX_EDGE = 2048;

/** DESIGN.md 8.2: 서버 디코딩 픽셀 수 상한 40MP. DB `upload_max_pixels` 기본값과 같다. */
export const MEMORY_PHOTO_MAX_PIXELS = 40_000_000;

/** 입력 파일과 업로드 파일 모두 10MiB 이하. DB `upload_max_bytes`, 버킷 `file_size_limit`과 같다. */
export const MEMORY_PHOTO_MAX_BYTES = MEMORY_LIMITS.photoBytesMax;

/** 업로드 가능한 형식. HEIC는 여기 없다(안내와 함께 거부). */
export const MEMORY_UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type MemoryUploadMime = (typeof MEMORY_UPLOAD_MIME_TYPES)[number];

export function isMemoryUploadMime(value: unknown): value is MemoryUploadMime {
  return (
    typeof value === 'string' && (MEMORY_UPLOAD_MIME_TYPES as readonly string[]).includes(value)
  );
}

/**
 * 필터 선택지(월·태그)를 만들 때 읽는 최대 기록 수.
 * 두 사람이 쓰는 공간이라 충분하지만, 넘으면 선택지가 일부 빠질 수 있다(목록 자체는 영향 없음).
 */
export const MEMORY_FILTER_OPTIONS_SCAN_LIMIT = 1000;

/**
 * 사진을 돌려주는 인증 경로. 서명 URL·공개 URL을 쓰지 않는다.
 * 확장자를 붙이지 않는다: 미들웨어가 확장자 경로를 정적 파일로 보고 세션 갱신을 건너뛴다.
 */
export function memoryPhotoUrl(assetId: string): string {
  return `/memories/photos/${assetId}`;
}
