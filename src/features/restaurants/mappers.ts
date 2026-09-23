import { RESTAURANT_STATUSES, type RestaurantStatus } from './constants';

import type { RestaurantCursor } from './filters';
import type { RestaurantDetail, RestaurantListItem, RestaurantPage, ReviewView } from './types';

/**
 * DB 행 → 화면 모델 변환(순수 함수).
 *
 * 형식이 계약과 다르면 조용히 기본값으로 바꾸지 않고 `null`을 돌려준다.
 * 호출자는 그 행을 "조회 실패"로 다룬다(빈 목록·저장 성공처럼 보이지 않게).
 */

export const RESTAURANT_LIST_COLUMNS = 'id, name, area, category, status, visited_date, created_at';
export const RESTAURANT_DETAIL_COLUMNS =
  'id, name, area, category, status, visited_date, created_at, map_url, memo, version, created_by, updated_at';
export const REVIEW_COLUMNS = 'id, restaurant_id, user_id, rating, comment, version, updated_at';

type Row = Record<string, unknown>;

function isStatus(value: unknown): value is RestaurantStatus {
  return typeof value === 'string' && (RESTAURANT_STATUSES as readonly string[]).includes(value);
}

function str(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

export function toListItem(row: Row): RestaurantListItem | null {
  const id = str(row, 'id');
  const name = str(row, 'name');
  const createdAt = str(row, 'created_at');
  const status = row.status;
  if (!id || name === null || !createdAt || !isStatus(status)) return null;

  return {
    id,
    name,
    area: str(row, 'area') ?? '',
    category: str(row, 'category') ?? '',
    status,
    visitedDate: str(row, 'visited_date'),
    createdAt,
  };
}

export function toDetail(row: Row): RestaurantDetail | null {
  const base = toListItem(row);
  const version = row.version;
  const createdBy = str(row, 'created_by');
  const updatedAt = str(row, 'updated_at');
  if (!base || typeof version !== 'number' || !createdBy || !updatedAt) return null;

  return {
    ...base,
    mapUrl: str(row, 'map_url'),
    memo: str(row, 'memo') ?? '',
    version,
    createdBy,
    updatedAt,
  };
}

export function toReview(
  row: Row,
  viewerId: string,
  nicknames: ReadonlyMap<string, string | null>,
): ReviewView | null {
  const id = str(row, 'id');
  const userId = str(row, 'user_id');
  const rating = row.rating;
  const version = row.version;
  const updatedAt = str(row, 'updated_at');
  if (!id || !userId || typeof rating !== 'number' || typeof version !== 'number' || !updatedAt) {
    return null;
  }

  const isMine = userId === viewerId;
  const nickname = nicknames.get(userId) ?? null;
  return {
    id,
    userId,
    rating,
    comment: str(row, 'comment') ?? '',
    version,
    updatedAt,
    isMine,
    authorLabel: nickname ?? (isMine ? '나' : '상대방'),
  };
}

/** 내 후기를 먼저, 그다음 상대방 후기를 보여 준다. */
export function sortReviews(reviews: ReviewView[]): ReviewView[] {
  return reviews.slice().sort((a, b) => Number(b.isMine) - Number(a.isMine));
}

/**
 * `pageSize + 1`개를 읽은 결과로 한 페이지와 다음 커서를 만든다.
 * 행 하나라도 형식이 어긋나면 null(조회 실패로 처리)이다.
 */
export function buildPage(rows: Row[], pageSize: number): RestaurantPage | null {
  const items: RestaurantListItem[] = [];
  for (const row of rows.slice(0, pageSize)) {
    const item = toListItem(row);
    if (!item) return null;
    items.push(item);
  }

  const last = items[items.length - 1];
  const nextCursor: RestaurantCursor | null =
    rows.length > pageSize && last ? { createdAt: last.createdAt, id: last.id } : null;

  return { items, nextCursor };
}
