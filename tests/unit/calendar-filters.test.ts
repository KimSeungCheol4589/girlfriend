import { describe, expect, it } from 'vitest';

import {
  buildCalendarHref,
  hasActiveFilter,
  isScopeActive,
  matchesScope,
  parseCalendarBackHref,
  parseCalendarFilters,
  toggleScope,
} from '@/features/calendar/filters';

import { CALENDAR_SCOPES } from '@/features/calendar/constants';

const TODAY = '2026-09-23';

function parse(params: Record<string, string | string[] | undefined>) {
  return parseCalendarFilters(params, TODAY);
}

describe('parseCalendarFilters', () => {
  it('아무것도 없으면 이번 달·월 보기·필터 없음이다', () => {
    expect(parse({})).toEqual({ month: '2026-09', view: 'month', scopes: [], status: null });
  });

  it('알 수 없는 값은 버린다', () => {
    expect(parse({ month: '2026-13', view: 'week', status: 'archived', scope: 'nobody' })).toEqual({
      month: '2026-09',
      view: 'month',
      scopes: [],
      status: null,
    });
  });

  it('여러 범위를 읽고 상수 순서로 고정한다', () => {
    expect(parse({ scope: ['shared', 'mine'] }).scopes).toEqual(['mine', 'shared']);
  });

  it('중복은 한 번만 센다', () => {
    expect(parse({ scope: ['mine', 'mine'] }).scopes).toEqual(['mine']);
  });

  it('전부 고른 것은 "모두"와 같다', () => {
    expect(parse({ scope: ['mine', 'partner', 'shared'] }).scopes).toEqual([]);
  });

  it('보기·상태를 읽는다', () => {
    expect(parse({ view: 'list', status: 'done' })).toMatchObject({
      view: 'list',
      status: 'done',
    });
  });
});

describe('buildCalendarHref', () => {
  it('같은 필터는 같은 주소가 된다(범위 순서에 흔들리지 않는다)', () => {
    const a = buildCalendarHref(parse({ scope: ['shared', 'mine'], month: '2026-11' }));
    const b = buildCalendarHref(parse({ scope: ['mine', 'shared'], month: '2026-11' }));
    expect(a).toBe(b);
    expect(a).toBe('/calendar?month=2026-11&scope=mine&scope=shared');
  });

  it('기본 보기는 주소에 넣지 않는다', () => {
    expect(buildCalendarHref(parse({}))).toBe('/calendar?month=2026-09');
    expect(buildCalendarHref(parse({ view: 'list' }))).toBe('/calendar?month=2026-09&view=list');
  });

  it('왕복해도 같은 필터다', () => {
    const filters = parse({ month: '2027-02', view: 'list', scope: ['partner'], status: 'cancelled' });
    const href = buildCalendarHref(filters);
    const query = href.slice(href.indexOf('?') + 1);
    const params = new URLSearchParams(query);
    expect(
      parseCalendarFilters(
        {
          month: params.get('month') ?? undefined,
          view: params.get('view') ?? undefined,
          scope: params.getAll('scope'),
          status: params.get('status') ?? undefined,
        },
        TODAY,
      ),
    ).toEqual(filters);
  });
});

describe('hasActiveFilter / toggleScope', () => {
  it('달·보기만 바꾼 것은 필터가 아니다', () => {
    expect(hasActiveFilter(parse({ month: '2026-11', view: 'list' }))).toBe(false);
    expect(hasActiveFilter(parse({ status: 'done' }))).toBe(true);
    expect(hasActiveFilter(parse({ scope: 'mine' }))).toBe(true);
  });

  it('켜고 끈다', () => {
    const base = parse({});
    const withMine = toggleScope(base, 'mine');
    expect(withMine.scopes).toEqual(['mine']);
    expect(toggleScope(withMine, 'mine').scopes).toEqual([]);
    expect(toggleScope(withMine, 'shared').scopes).toEqual(['mine', 'shared']);
  });

  it('세 개를 모두 켜면 "모두"로 돌아간다', () => {
    let filters = parse({});
    for (const scope of ['mine', 'partner', 'shared'] as const) {
      filters = toggleScope(filters, scope);
    }
    expect(filters.scopes).toEqual([]);
  });
});

/**
 * 범위 칩의 강조 (독립 검토 P3-6 회귀).
 *
 * 세 칩을 모두 고르면 `toggleScope`가 `[]`("모두")로 정규화한다. 그때 강조가 전부 꺼지면
 * 선택이 취소된 것처럼 보인다. "보이는 것"과 "강조"를 맞춘다.
 */
describe('isScopeActive', () => {
  it('아무것도 고르지 않았으면 셋 다 강조한다(모두 보여 주는 중)', () => {
    const filters = parse({});
    expect(filters.scopes).toEqual([]);
    for (const scope of CALENDAR_SCOPES) {
      expect(isScopeActive(filters, scope), scope).toBe(true);
    }
  });

  it('하나만 골랐으면 그것만 강조한다', () => {
    const filters = parse({ scope: 'mine' });
    expect(isScopeActive(filters, 'mine')).toBe(true);
    expect(isScopeActive(filters, 'partner')).toBe(false);
    expect(isScopeActive(filters, 'shared')).toBe(false);
  });

  it('두 개를 골랐으면 둘만 강조한다', () => {
    const filters = parse({ scope: ['mine', 'shared'] });
    expect(isScopeActive(filters, 'mine')).toBe(true);
    expect(isScopeActive(filters, 'shared')).toBe(true);
    expect(isScopeActive(filters, 'partner')).toBe(false);
  });

  it('세 개를 차례로 누르면 마지막에도 셋 다 강조로 남는다', () => {
    let filters = parse({});
    for (const scope of CALENDAR_SCOPES) {
      filters = toggleScope(filters, scope);
    }
    // 정규화 결과는 "모두"이고, 강조는 꺼지지 않는다.
    expect(filters.scopes).toEqual([]);
    for (const scope of CALENDAR_SCOPES) {
      expect(isScopeActive(filters, scope), scope).toBe(true);
    }
  });

  it('URL로 세 개를 직접 넘겨도 셋 다 강조한다', () => {
    const filters = parse({ scope: ['mine', 'partner', 'shared'] });
    for (const scope of CALENDAR_SCOPES) {
      expect(isScopeActive(filters, scope), scope).toBe(true);
    }
  });

  it('강조와 실제로 보이는 일정이 어긋나지 않는다', () => {
    const viewer = 'user-a';
    const samples = [
      { scope: 'mine' as const, event: { kind: 'personal', ownerId: viewer } },
      { scope: 'partner' as const, event: { kind: 'personal', ownerId: 'user-b' } },
      { scope: 'shared' as const, event: { kind: 'date', ownerId: null } },
    ];
    for (const filters of [parse({}), parse({ scope: 'mine' }), parse({ scope: ['mine', 'shared'] })]) {
      for (const { scope, event } of samples) {
        expect(matchesScope(filters, event, viewer), `${scope} / ${filters.scopes.join(',')}`).toBe(
          isScopeActive(filters, scope),
        );
      }
    }
  });
});

describe('matchesScope', () => {
  const viewer = 'user-a';
  const mine = { kind: 'personal', ownerId: viewer };
  const partner = { kind: 'personal', ownerId: 'user-b' };
  const shared = { kind: 'date', ownerId: null };

  it('아무것도 고르지 않으면 모두 보여 준다', () => {
    const filters = parse({});
    for (const event of [mine, partner, shared]) {
      expect(matchesScope(filters, event, viewer)).toBe(true);
    }
  });

  it('내 일정만', () => {
    const filters = parse({ scope: 'mine' });
    expect(matchesScope(filters, mine, viewer)).toBe(true);
    expect(matchesScope(filters, partner, viewer)).toBe(false);
    expect(matchesScope(filters, shared, viewer)).toBe(false);
  });

  it('상대 일정만', () => {
    const filters = parse({ scope: 'partner' });
    expect(matchesScope(filters, partner, viewer)).toBe(true);
    expect(matchesScope(filters, mine, viewer)).toBe(false);
  });

  it('함께하는 일정만', () => {
    const filters = parse({ scope: 'shared' });
    expect(matchesScope(filters, shared, viewer)).toBe(true);
    expect(matchesScope(filters, mine, viewer)).toBe(false);
  });

  it('두 범위를 함께 고를 수 있다', () => {
    const filters = parse({ scope: ['mine', 'shared'] });
    expect(matchesScope(filters, mine, viewer)).toBe(true);
    expect(matchesScope(filters, shared, viewer)).toBe(true);
    expect(matchesScope(filters, partner, viewer)).toBe(false);
  });
});

describe('parseCalendarBackHref', () => {
  it('검색 매개변수만 읽어 우리 주소로 다시 만든다', () => {
    expect(parseCalendarBackHref('/calendar?month=2026-11&view=list', TODAY)).toBe(
      '/calendar?month=2026-11&view=list',
    );
  });

  it('다른 경로·외부 주소로 보낼 수 없다', () => {
    expect(parseCalendarBackHref('https://evil.invalid/steal?month=2026-11', TODAY)).toBe(
      '/calendar?month=2026-11',
    );
    expect(parseCalendarBackHref('/settings', TODAY)).toBe('/calendar?month=2026-09');
    expect(parseCalendarBackHref('//evil.invalid', TODAY)).toBe('/calendar?month=2026-09');
    expect(parseCalendarBackHref('javascript:alert(1)', TODAY)).toBe('/calendar?month=2026-09');
  });

  it('값이 없거나 형식이 아니면 이번 달 캘린더다', () => {
    expect(parseCalendarBackHref(undefined, TODAY)).toBe('/calendar?month=2026-09');
    expect(parseCalendarBackHref(['/calendar?month=2026-11'], TODAY)).toBe('/calendar?month=2026-09');
  });

  it('알 수 없는 매개변수는 버린다', () => {
    expect(parseCalendarBackHref('/calendar?month=2026-11&evil=1&view=week', TODAY)).toBe(
      '/calendar?month=2026-11',
    );
  });
});
