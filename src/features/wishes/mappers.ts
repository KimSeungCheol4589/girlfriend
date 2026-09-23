import { WISH_CATEGORIES, WISH_STATUSES, type WishCategory, type WishStatus } from './constants';

import type { WishCursor } from './filters';
import type { WishDetail, WishListItem, WishPage } from './types';

/**
 * DB 행 → 화면 모델 변환(순수 함수).
 *
 * 형식이 계약과 다르면 조용히 기본값으로 바꾸지 않고 `null`을 돌려준다.
 * 호출자는 그 행을 "조회 실패"로 다룬다(빈 목록·저장 성공처럼 보이지 않게).
 */

export const WISH_LIST_COLUMNS = 'id, title, category, status, planned_date, created_at';
export const WISH_DETAIL_COLUMNS =
  'id, title, category, status, planned_date, created_at, memo, link_url, version, created_by, updated_at';

type Row = Record<string, unknown>;

function isStatus(value: unknown): value is WishStatus {
  return typeof value === 'string' && (WISH_STATUSES as readonly string[]).includes(value);
}

function isCategory(value: unknown): value is WishCategory {
  return typeof value === 'string' && (WISH_CATEGORIES as readonly string[]).includes(value);
}

function str(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

export function toListItem(row: Row): WishListItem | null {
  const id = str(row, 'id');
  const title = str(row, 'title');
  const createdAt = str(row, 'created_at');
  if (!id || title === null || !createdAt || !isStatus(row.status) || !isCategory(row.category)) {
    return null;
  }

  return {
    id,
    title,
    category: row.category,
    status: row.status,
    plannedDate: str(row, 'planned_date'),
    createdAt,
  };
}

export function toDetail(
  row: Row,
  viewerId: string,
  nicknames: ReadonlyMap<string, string | null>,
): WishDetail | null {
  const base = toListItem(row);
  const version = row.version;
  const createdBy = str(row, 'created_by');
  const updatedAt = str(row, 'updated_at');
  if (!base || typeof version !== 'number' || !createdBy || !updatedAt) return null;

  const nickname = nicknames.get(createdBy) ?? null;
  return {
    ...base,
    memo: str(row, 'memo') ?? '',
    linkUrl: str(row, 'link_url'),
    version,
    createdBy,
    updatedAt,
    createdByLabel: nickname ?? (createdBy === viewerId ? '나' : '상대방'),
  };
}

/**
 * `pageSize + 1`개를 읽은 결과로 한 페이지와 다음 커서를 만든다.
 * 행 하나라도 형식이 어긋나면 null(조회 실패로 처리)이다.
 */
export function buildPage(rows: Row[], pageSize: number): WishPage | null {
  const items: WishListItem[] = [];
  for (const row of rows.slice(0, pageSize)) {
    const item = toListItem(row);
    if (!item) return null;
    items.push(item);
  }

  const last = items[items.length - 1];
  const nextCursor: WishCursor | null =
    rows.length > pageSize && last ? { createdAt: last.createdAt, id: last.id } : null;

  return { items, nextCursor };
}
