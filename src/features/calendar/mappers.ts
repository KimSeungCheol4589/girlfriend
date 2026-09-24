import { EVENT_KINDS, EVENT_STATUSES, type EventKind, type EventStatus } from './constants';
import { toSeoulMoment } from './datetime';

import type { CalendarEventDetail, CalendarEventItem } from './types';

/**
 * DB 행 → 화면 모델 변환(순수 함수).
 *
 * 형식이 계약과 다르면 조용히 기본값으로 바꾸지 않고 `null`을 돌려준다.
 * 호출자는 그 행을 "조회 실패"로 다룬다(빈 목록·저장 성공처럼 보이지 않게).
 *
 * 시각은 여기서 한국 시간 날짜·시:분으로 바꾼다. 화면은 timestamptz를 직접 다루지 않는다.
 */

export const CALENDAR_LIST_COLUMNS =
  'id, kind, owner_id, title, location, starts_at, ends_at, all_day, status, wish_item_id';
export const CALENDAR_DETAIL_COLUMNS = `${CALENDAR_LIST_COLUMNS}, note, version, created_by, updated_at`;

type Row = Record<string, unknown>;

export type ViewerScope = {
  viewerId: string;
  /** userId → 닉네임. 없으면 `나`/`상대방`으로 보여 준다. */
  nicknames: ReadonlyMap<string, string | null>;
};

function isKind(value: unknown): value is EventKind {
  return typeof value === 'string' && (EVENT_KINDS as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is EventStatus {
  return typeof value === 'string' && (EVENT_STATUSES as readonly string[]).includes(value);
}

function str(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function ownerLabelFor(kind: EventKind, ownerId: string | null, scope: ViewerScope): string {
  if (kind === 'date' || ownerId === null) return '함께';
  if (ownerId === scope.viewerId) return '내 일정';
  return scope.nicknames.get(ownerId) ?? '상대 일정';
}

export function toListItem(row: Row, scope: ViewerScope): CalendarEventItem | null {
  const id = str(row, 'id');
  const title = str(row, 'title');
  const allDay = row.all_day;
  if (!id || title === null || typeof allDay !== 'boolean') return null;
  if (!isKind(row.kind) || !isStatus(row.status)) return null;

  const ownerId = str(row, 'owner_id');
  // 계약: personal이면 owner가 있고 date면 없다. 어긋나면 권한 판단이 흔들리므로 실패로 다룬다.
  if ((row.kind === 'personal') !== (ownerId !== null)) return null;

  const start = toSeoulMoment(row.starts_at);
  if (!start) return null;
  const end = row.ends_at === null || row.ends_at === undefined ? null : toSeoulMoment(row.ends_at);
  if (row.ends_at !== null && row.ends_at !== undefined && !end) return null;
  // 종일 일정은 종료가 반드시 있다(DB 제약). 없으면 계약과 다른 행이다.
  if (allDay && !end) return null;

  return {
    id,
    kind: row.kind,
    ownerId,
    title,
    location: str(row, 'location'),
    allDay,
    status: row.status,
    wishItemId: str(row, 'wish_item_id'),
    startDate: start.date,
    startTime: allDay ? null : start.time,
    endDate: end ? end.date : start.date,
    endTime: end && !allDay ? end.time : null,
    hasEnd: end !== null,
    canEdit: ownerId === null || ownerId === scope.viewerId,
    ownerLabel: ownerLabelFor(row.kind, ownerId, scope),
  };
}

export function toDetail(row: Row, scope: ViewerScope): CalendarEventDetail | null {
  const base = toListItem(row, scope);
  const version = row.version;
  const createdBy = str(row, 'created_by');
  const updatedAt = str(row, 'updated_at');
  if (!base || typeof version !== 'number' || !createdBy || !updatedAt) return null;

  const nickname = scope.nicknames.get(createdBy) ?? null;
  return {
    ...base,
    note: str(row, 'note') ?? '',
    version,
    createdBy,
    createdByLabel: nickname ?? (createdBy === scope.viewerId ? '나' : '상대방'),
    updatedAt,
    linkedWish: null,
  };
}

/** 한 페이지 분량의 행을 모두 바꾼다. 하나라도 형식이 어긋나면 null(조회 실패)이다. */
export function toListItems(rows: Row[], scope: ViewerScope): CalendarEventItem[] | null {
  const items: CalendarEventItem[] = [];
  for (const row of rows) {
    const item = toListItem(row, scope);
    if (!item) return null;
    items.push(item);
  }
  return items;
}

/** 시작이 이른 순. 같으면 종일을 먼저, 그다음 제목·ID로 안정 정렬한다. */
export function compareEvents(a: CalendarEventItem, b: CalendarEventItem): number {
  const aKey = `${a.startDate}T${a.allDay ? '00:00' : (a.startTime ?? '00:00')}`;
  const bKey = `${b.startDate}T${b.allDay ? '00:00' : (b.startTime ?? '00:00')}`;
  if (aKey !== bKey) return aKey < bKey ? -1 : 1;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
