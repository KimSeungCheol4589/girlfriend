import { describe, expect, it } from 'vitest';

import {
  CALENDAR_DETAIL_COLUMNS,
  CALENDAR_LIST_COLUMNS,
  compareEvents,
  toDetail,
  toListItem,
  toListItems,
} from '@/features/calendar/mappers';

/**
 * DB 행 → 화면 모델. 계약과 다른 행은 조용히 기본값으로 바꾸지 않고 null이다(조회 실패로 다룬다).
 * 권한 표시(`canEdit`)는 owner_id와 보는 사람으로만 정한다.
 */

const VIEWER = 'user-a';
const PARTNER = 'user-b';

const scope = {
  viewerId: VIEWER,
  nicknames: new Map<string, string | null>([
    [VIEWER, '에이'],
    [PARTNER, '비이'],
  ]),
};

const scopeWithoutNames = { viewerId: VIEWER, nicknames: new Map<string, string | null>() };

const sharedRow = {
  id: 'e1',
  kind: 'date',
  owner_id: null,
  title: '전시 보러 가기',
  location: '서울시립미술관',
  starts_at: '2026-12-05T02:00:00Z', // 11:00 KST
  ends_at: '2026-12-05T04:00:00Z', // 13:00 KST
  all_day: false,
  status: 'scheduled',
  wish_item_id: null,
};

const personalRow = {
  ...sharedRow,
  id: 'e2',
  kind: 'personal',
  owner_id: PARTNER,
  title: '상대 치과',
  ends_at: null,
};

describe('조회 열 목록', () => {
  it('상세는 목록 열을 포함한다', () => {
    expect(CALENDAR_DETAIL_COLUMNS.startsWith(CALENDAR_LIST_COLUMNS)).toBe(true);
    for (const column of ['note', 'version', 'created_by', 'updated_at']) {
      expect(CALENDAR_DETAIL_COLUMNS).toContain(column);
    }
  });
});

describe('toListItem', () => {
  it('시각을 한국 날짜·시:분으로 바꾼다', () => {
    const item = toListItem(sharedRow, scope);
    expect(item).toMatchObject({
      id: 'e1',
      kind: 'date',
      ownerId: null,
      startDate: '2026-12-05',
      startTime: '11:00',
      endDate: '2026-12-05',
      endTime: '13:00',
      hasEnd: true,
      allDay: false,
    });
  });

  it('공동 일정은 두 사람 모두 바꿀 수 있다', () => {
    expect(toListItem(sharedRow, scope)?.canEdit).toBe(true);
    expect(toListItem(sharedRow, { ...scope, viewerId: PARTNER })?.canEdit).toBe(true);
    expect(toListItem(sharedRow, scope)?.ownerLabel).toBe('함께');
  });

  it('개인 일정은 소유자만 바꿀 수 있다', () => {
    const asViewer = toListItem(personalRow, scope);
    expect(asViewer?.canEdit).toBe(false);
    expect(asViewer?.ownerLabel).toBe('비이');

    const asOwner = toListItem(personalRow, { ...scope, viewerId: PARTNER });
    expect(asOwner?.canEdit).toBe(true);
    expect(asOwner?.ownerLabel).toBe('내 일정');
  });

  it('닉네임이 없으면 "상대 일정"으로 보여 준다', () => {
    expect(toListItem(personalRow, scopeWithoutNames)?.ownerLabel).toBe('상대 일정');
  });

  it('종료가 없으면 시작일과 같고 hasEnd가 false다', () => {
    const item = toListItem(personalRow, scope);
    expect(item).toMatchObject({ endDate: '2026-12-05', endTime: null, hasEnd: false });
  });

  it('종일 일정은 시각을 비우고 포함 종료일을 쓴다', () => {
    const item = toListItem(
      {
        ...sharedRow,
        all_day: true,
        starts_at: '2026-10-02T15:00:00Z', // 2026-10-03 00:00 KST
        ends_at: '2026-10-04T15:00:00Z', // 2026-10-05 00:00 KST
      },
      scope,
    );
    expect(item).toMatchObject({
      allDay: true,
      startDate: '2026-10-03',
      startTime: null,
      endDate: '2026-10-05',
      endTime: null,
      hasEnd: true,
    });
  });

  it('자정을 넘기는 시간 일정의 종료일은 다음 날이다', () => {
    const item = toListItem(
      {
        ...sharedRow,
        starts_at: '2026-11-07T14:00:00Z', // 23:00 KST
        ends_at: '2026-11-07T16:30:00Z', // 다음 날 01:30 KST
      },
      scope,
    );
    expect(item).toMatchObject({ startDate: '2026-11-07', endDate: '2026-11-08', endTime: '01:30' });
  });

  it('계약과 다른 행은 null이다', () => {
    expect(toListItem({ ...sharedRow, kind: 'meeting' }, scope)).toBeNull();
    expect(toListItem({ ...sharedRow, status: 'archived' }, scope)).toBeNull();
    expect(toListItem({ ...sharedRow, all_day: 'false' }, scope)).toBeNull();
    expect(toListItem({ ...sharedRow, starts_at: '어제' }, scope)).toBeNull();
    expect(toListItem({ ...sharedRow, ends_at: '어제' }, scope)).toBeNull();
    expect(toListItem({ ...sharedRow, title: 123 }, scope)).toBeNull();
    expect(toListItem({ ...sharedRow, id: null }, scope)).toBeNull();
  });

  it('종일인데 종료가 없으면 null이다(DB 제약과 어긋난 행)', () => {
    expect(toListItem({ ...sharedRow, all_day: true, ends_at: null }, scope)).toBeNull();
  });

  it('kind와 owner가 어긋난 행은 null이다(권한 판단이 흔들리지 않게)', () => {
    expect(toListItem({ ...sharedRow, kind: 'personal', owner_id: null }, scope)).toBeNull();
    expect(toListItem({ ...sharedRow, kind: 'date', owner_id: PARTNER }, scope)).toBeNull();
  });
});

describe('toListItems', () => {
  it('한 행만 어긋나도 전체가 null이다', () => {
    expect(toListItems([sharedRow, personalRow], scope)).toHaveLength(2);
    expect(toListItems([sharedRow, { ...personalRow, kind: 'x' }], scope)).toBeNull();
  });
});

describe('toDetail', () => {
  const detailRow = {
    ...sharedRow,
    note: '예약 필요',
    version: 3,
    created_by: PARTNER,
    updated_at: '2026-11-01T00:00:00Z',
  };

  it('메모·버전·만든 사람을 담고 위시 연결은 따로 채운다', () => {
    const detail = toDetail(detailRow, scope);
    expect(detail).toMatchObject({
      note: '예약 필요',
      version: 3,
      createdBy: PARTNER,
      createdByLabel: '비이',
      linkedWish: null,
    });
  });

  it('닉네임이 없으면 나/상대방으로 보여 준다', () => {
    expect(toDetail(detailRow, scopeWithoutNames)?.createdByLabel).toBe('상대방');
    expect(toDetail({ ...detailRow, created_by: VIEWER }, scopeWithoutNames)?.createdByLabel).toBe('나');
  });

  it('버전이 숫자가 아니면 null이다', () => {
    expect(toDetail({ ...detailRow, version: '3' }, scope)).toBeNull();
    expect(toDetail({ ...detailRow, created_by: null }, scope)).toBeNull();
  });
});

describe('compareEvents', () => {
  function event(overrides: Record<string, unknown>) {
    return toListItem({ ...sharedRow, ...overrides }, scope)!;
  }

  it('시작이 이른 순이다', () => {
    const early = event({ id: 'a', starts_at: '2026-12-05T01:00:00Z' });
    const late = event({ id: 'b', starts_at: '2026-12-05T05:00:00Z' });
    expect([late, early].sort(compareEvents)[0]?.id).toBe('a');
  });

  it('같은 시각이면 종일을 먼저 보여 준다', () => {
    const allDay = event({
      id: 'a',
      all_day: true,
      starts_at: '2026-12-04T15:00:00Z',
      ends_at: '2026-12-04T15:00:00Z',
    });
    const timed = event({ id: 'b', starts_at: '2026-12-04T15:00:00Z' });
    expect([timed, allDay].sort(compareEvents)[0]?.id).toBe('a');
  });

  it('같은 순서 값이면 제목·ID로 안정적으로 정렬한다', () => {
    const first = event({ id: 'b', title: '가' });
    const second = event({ id: 'a', title: '나' });
    expect([second, first].sort(compareEvents).map((item) => item.id)).toEqual(['b', 'a']);
  });
});
