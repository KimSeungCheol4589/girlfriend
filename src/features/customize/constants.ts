import { MEMORY_BUCKET, MEMORY_PHOTO_MAX_BYTES, MEMORY_UPLOAD_MIME_TYPES } from '@/features/memories/live/constants';

/**
 * 실제(live) 꾸미기 기능의 계약 상수.
 *
 * 기준: DESIGN.md 4.1·4.2·8.2, docs/database/CONTRACTS.md 2·5.
 * 커버 사진은 추억 사진과 **같은 버킷·같은 제한·같은 파이프라인**을 쓴다(용도만 `cover`다).
 * 그래서 값 자체를 새로 정의하지 않고 추억 쪽 상수를 그대로 참조한다. 두 값이 갈라지면
 * DB `upload_max_bytes`·버킷 제한과도 어긋나기 때문이다.
 */

export const COVER_BUCKET = MEMORY_BUCKET;
export const COVER_MAX_BYTES = MEMORY_PHOTO_MAX_BYTES;
export const COVER_UPLOAD_MIME_TYPES = MEMORY_UPLOAD_MIME_TYPES;

/** `assets.purpose`. 커버 경로는 이 값만 다룬다. */
export const COVER_PURPOSE = 'cover' as const;

/**
 * 커버 사진을 돌려주는 인증 경로. 서명 URL·공개 URL·이미지 최적화 서버를 쓰지 않는다.
 * 확장자를 붙이지 않는다: 미들웨어가 확장자 경로를 정적 파일로 보고 세션 갱신을 건너뛴다.
 */
export function coverPhotoUrl(assetId: string): string {
  return `/customize/cover/${assetId}`;
}

/** 고정 추억 후보 목록에서 한 번에 읽는 최대 개수(고정된 기록은 별도로 모두 읽는다). */
export const PINNED_CANDIDATE_LIMIT = 50;
