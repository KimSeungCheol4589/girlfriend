import { describe, expect, it } from 'vitest';

import {
  dayGroups,
  eventDates,
  gridEventsByDate,
  groupByDate,
} from '@/features/calendar/grouping';
import { toListItem } from '@/features/calendar/mappers';

const scope = { viewerId: 'user-a', nicknames: new Map<string, string | null>() };

function event(overrides: Record<string, unknown>) {
  const row = {
    id: 'e1',
    kind: 'date',
    owner_id: null,
    title: '일정',
    location: null,
    starts_at: '2026-12-05T02:00:00Z',
    ends_at: null,
    all_day: false,
    status: 'scheduled',
    wish_item_id: null,
    ...overrides,
  };
  const item = toListItem(row, scope);
  if (!item) throw new Error('픽스처가 계약과 다릅니다');
  return item;
}

describe('eventDates', () => {
  it('하루 일정은 하루만', () => {
    expect(eventDates(event({}))).toEqual(['2026-12-05']);
  });

  it('여러 날 종일 일정은 걸친 날을 모두 담는다', () => {
    const trip = event({
      all_day: true,
      starts_at: '2026-10-02T15:00:00Z', // 10-03 00:00 KST
      ends_at: '2026-10-04T15:00:00Z', // 10-05 00:00 KST
    });
    expect(eventDates(trip)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
  });

  it('자정을 넘기는 시간 일정은 두 날에 걸친다', () => {
    const overnight = event({
      starts_at: '2026-11-07T14:00:00Z', // 23:00 KST
      ends_at: '2026-11-07T16:30:00Z', // 다음 날 01:30 KST
    });
    expect(eventDates(overnight)).toEqual(['2026-11-07', '2026-11-08']);
  });
});

describe('groupByDate', () => {
  it('걸친 날마다 같은 일정이 들어간다', () => {
    const trip = event({
      id: 'trip',
      all_day: true,
      starts_at: '2026-10-02T15:00:00Z',
      ends_at: '2026-10-04T15:00:00Z',
    });
    const single = event({ id: 'single', starts_at: '2026-10-04T02:00:00Z' });
    const grouped = groupByDate([trip, single]);

    expect(grouped.get('2026-10-03')?.map((item) => item.id)).toEqual(['trip']);
    // 같은 날이면 종일 일정을 먼저 보여 준다.
    expect(grouped.get('2026-10-04')?.map((item) => item.id)).toEqual(['trip', 'single']);
    expect(grouped.get('2026-10-05')?.map((item) => item.id)).toEqual(['trip']);
    expect(grouped.get('2026-10-06')).toBeUndefined();
  });

  it('한 날 안에서는 시작이 이른 순이다', () => {
    const later = event({ id: 'later', starts_at: '2026-12-05T05:00:00Z' });
    const earlier = event({ id: 'earlier', starts_at: '2026-12-05T01:00:00Z' });
    expect(groupByDate([later, earlier]).get('2026-12-05')?.map((item) => item.id)).toEqual([
      'earlier',
      'later',
    ]);
  });
});

/**
 * 월 격자의 앞뒤 달 칸 (독립 검토 P3-2 회귀).
 *
 * 조회는 보고 있는 달과 겹치는 일정만 가져온다. 그래서 앞뒤 달 칸에 일정을 그리면
 * "이번 달에 걸친 여러 날 일정"만 우연히 보이고 그 날 하루짜리 일정은 안 보인다.
 * 같은 칸에서 어떤 일정은 보이고 어떤 일정은 안 보이는 상태를 만들지 않는다.
 */
describe('gridEventsByDate', () => {
  // 2026년 10월 격자는 앞에 9/27~9/30, 뒤에 11/1~11/7 칸을 포함한다.
  const october = { from: '2026-10-01', toExclusive: '2026-11-01' };

  it('이번 달 칸에는 그대로 담는다', () => {
    const single = event({ id: 'single', starts_at: '2026-10-14T02:00:00Z' });
    const grouped = gridEventsByDate([single], october);
    expect(grouped.get('2026-10-14')?.map((item) => item.id)).toEqual(['single']);
  });

  it('다음 달로 넘어가는 여러 날 일정은 이번 달 칸까지만 담는다', () => {
    // 10/30 ~ 11/2 종일 여행.
    const trip = event({
      id: 'trip',
      all_day: true,
      starts_at: '2026-10-29T15:00:00Z', // 10-30 00:00 KST
      ends_at: '2026-11-01T15:00:00Z', // 11-02 00:00 KST
    });
    const grouped = gridEventsByDate([trip], october);

    expect(grouped.get('2026-10-30')?.map((item) => item.id)).toEqual(['trip']);
    expect(grouped.get('2026-10-31')?.map((item) => item.id)).toEqual(['trip']);
    // 11/1·11/2 칸은 격자에 그려지지만 일정을 담지 않는다.
    expect(grouped.get('2026-11-01')).toBeUndefined();
    expect(grouped.get('2026-11-02')).toBeUndefined();
  });

  it('지난 달에서 넘어온 여러 날 일정도 이번 달 칸에만 담는다', () => {
    // 9/29 ~ 10/2 종일 여행.
    const trip = event({
      id: 'trip',
      all_day: true,
      starts_at: '2026-09-28T15:00:00Z', // 09-29 00:00 KST
      ends_at: '2026-10-01T15:00:00Z', // 10-02 00:00 KST
    });
    const grouped = gridEventsByDate([trip], october);

    expect(grouped.get('2026-09-29')).toBeUndefined();
    expect(grouped.get('2026-09-30')).toBeUndefined();
    expect(grouped.get('2026-10-01')?.map((item) => item.id)).toEqual(['trip']);
    expect(grouped.get('2026-10-02')?.map((item) => item.id)).toEqual(['trip']);
  });

  it('앞뒤 달 칸은 여러 날 일정이든 하루 일정이든 똑같이 비어 있다', () => {
    const crossing = event({
      id: 'crossing',
      all_day: true,
      starts_at: '2026-10-30T15:00:00Z', // 10-31 00:00 KST
      ends_at: '2026-11-01T15:00:00Z', // 11-02 00:00 KST
    });
    // 11/1 하루짜리 일정은 애초에 10월 조회에 들어오지도 않는다(경계 조건 때문).
    const grouped = gridEventsByDate([crossing], october);
    expect(grouped.get('2026-11-01')).toBeUndefined();
    // 즉 11/1 칸은 "어떤 일정도 없음"으로 일관된다.
  });

  it('목록 보기의 범위 규칙과 같은 결과를 낸다', () => {
    const trip = event({
      id: 'trip',
      all_day: true,
      starts_at: '2026-10-29T15:00:00Z',
      ends_at: '2026-11-01T15:00:00Z',
    });
    const gridDates = [...gridEventsByDate([trip], october).keys()].sort();
    const listDates = dayGroups([trip], october).map((group) => group.date);
    expect(gridDates).toEqual(listDates);
  });
});

describe('dayGroups', () => {
  const range = { from: '2026-10-01', toExclusive: '2026-11-01' };

  it('날짜 오름차순으로 묶는다', () => {
    const a = event({ id: 'a', starts_at: '2026-10-20T02:00:00Z' });
    const b = event({ id: 'b', starts_at: '2026-10-05T02:00:00Z' });
    expect(dayGroups([a, b], range).map((group) => group.date)).toEqual(['2026-10-05', '2026-10-20']);
  });

  it('보고 있는 달 밖의 날짜는 제외한다', () => {
    // 9/30 ~ 10/2 여행: 10월 목록에는 10/1·10/2만 나온다.
    const trip = event({
      id: 'trip',
      all_day: true,
      starts_at: '2026-09-29T15:00:00Z', // 09-30 00:00 KST
      ends_at: '2026-10-01T15:00:00Z', // 10-02 00:00 KST
    });
    expect(dayGroups([trip], range).map((group) => group.date)).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('빈 목록은 빈 묶음이다', () => {
    expect(dayGroups([], range)).toEqual([]);
  });
});
