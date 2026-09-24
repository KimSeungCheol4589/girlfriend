import { describe, expect, it } from 'vitest';

import { dayGroups, eventDates, groupByDate } from '@/features/calendar/grouping';
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
