/**
 * 맛집 기능 계약 상수.
 *
 * 기준: DESIGN.md 5.2·9, docs/database/CONTRACTS.md 4, supabase/migrations의 CHECK 제약.
 * 화면·Server Action 검증은 "먼저 걸러 주는 안내"이고 최종 방어는 DB 함수다.
 */

import { RESTAURANT_LIMITS as SHARED_LIMITS } from '@/lib/contracts';

export const RESTAURANT_LIMITS = {
  ...SHARED_LIMITS,
  /** DB: restaurants_area_length / save_restaurant (≤50). */
  areaMax: 50,
  /** DB: restaurants_category_length / save_restaurant (≤50). */
  categoryMax: 50,
  /** DB: restaurants_map_url_length (11~500). */
  mapUrlMin: 11,
  mapUrlMax: 500,
  /** 이름 검색어 상한. 검색은 부분 일치라 이름 최대 길이면 충분하다. */
  searchMax: 100,
} as const;

export const RESTAURANT_STATUSES = ['wishlist', 'visited'] as const;
export type RestaurantStatus = (typeof RESTAURANT_STATUSES)[number];

export const STATUS_LABELS: Record<RestaurantStatus, string> = {
  wishlist: '가고 싶은 곳',
  visited: '다녀온 곳',
};

/** 색상만으로 상태를 구분하지 않도록 글자와 함께 쓰는 기호(PROJECT_PLAN 5). */
export const STATUS_ICONS: Record<RestaurantStatus, string> = {
  wishlist: '☆',
  visited: '✓',
};

/**
 * 지도 링크 허용 호스트.
 *
 * 원본은 DB의 `app_private.app_config.allowed_map_hosts`다(운영자가 관리).
 * 앱은 같은 목록으로 **먼저 안내**하고 링크를 그릴 때 한 번 더 확인한다.
 * DB 목록이 바뀌면 이 목록도 함께 바꿔야 한다. 서버는 링크를 가져오지 않는다(DESIGN 9).
 */
export const ALLOWED_MAP_HOSTS: readonly string[] = [
  'map.naver.com',
  'm.map.naver.com',
  'naver.me',
  'map.kakao.com',
  'place.map.kakao.com',
  'kko.to',
];

/** 목록 한 번에 불러오는 개수(DESIGN 3의 "더 보기"와 같은 단위). */
export const RESTAURANT_PAGE_SIZE = 20;
