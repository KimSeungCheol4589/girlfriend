import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 캘린더 Server Action 단위 테스트.
 *
 * Supabase 클라이언트·세션·캐시 무효화만 가짜로 바꾼다. 확인하는 것:
 *   - 잘못된 입력·요청 키는 RPC를 부르지 않는다(서버에서 다시 검증).
 *   - RPC 이름·인자가 마이그레이션의 서명과 맞는다. 사용자·공간·소유자 ID는 보내지 않는다.
 *   - 종일 일정에는 시각을 보내지 않는다.
 *   - 실패는 코드·문장으로만 돌려주고, 저장 여부를 모르면 성공으로 말하지 않는다.
 *   - 캐시 무효화는 성공했을 때만 한다.
 *   - 로그에 사용자 입력이 들어가지 않는다.
 */

const fake = vi.hoisted(() => {
  type Response = {
    data: unknown;
    error: { code?: string; message?: string; details?: string } | null;
  };
  const state = {
    rpcResponse: { data: null, error: null } as Response,
    rpcThrows: false,
    queryResponse: { data: [], error: null } as Response,
    queryCalls: [] as [string, unknown[]][],
  };
  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => {
    if (state.rpcThrows) throw new TypeError('fetch failed');
    return state.rpcResponse;
  });
  function builder() {
    const target: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'lt', 'or', 'order', 'limit', 'maybeSingle']) {
      target[method] = (...args: unknown[]) => {
        state.queryCalls.push([method, args]);
        return target;
      };
    }
    target.then = (resolve: (value: Response) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(state.queryResponse).then(resolve, reject);
    return target;
  }
  const client = {
    rpc,
    from: (table: string) => {
      state.queryCalls.push(['from', [table]]);
      return builder();
    },
  };
  return { state, rpc, client };
});

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => fake.client),
  getVerifiedUser: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/features/auth/queries', () => ({
  getSessionContext: vi.fn(async () => ({
    status: 'member',
    user: { id: 'user-a', email: null, emailConfirmed: true },
    profile: null,
    space: { id: 'space-1', name: '공간', introduction: '', relationshipStartDate: null, version: 1 },
    members: [],
    settings: null,
  })),
}));

import { revalidatePath } from 'next/cache';

import {
  deleteCalendarEventAction,
  saveCalendarEventAction,
  setCalendarEventStatusAction,
} from '@/features/calendar/actions';

const REQUEST_ID = '0b0e8d1c-2f3a-4b5c-8d6e-7f8091a2b3c4';
const EVENT_ID = '3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69';
const WISH_ID = '7a9b1c2d-3e4f-4a5b-8c6d-9e0f1a2b3c4d';

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fake.rpc.mockClear();
  vi.mocked(revalidatePath).mockClear();
  fake.state.rpcResponse = { data: null, error: null };
  fake.state.rpcThrows = false;
  fake.state.queryResponse = { data: [], error: null };
  fake.state.queryCalls = [];
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errorLog.mockRestore();
});

const validEvent = {
  eventId: null as string | null,
  kind: 'date' as const,
  title: '  전시 보러 가기 ',
  location: ' 서울시립미술관 ',
  note: '비밀 메모',
  allDay: false,
  startDate: '2026-12-05',
  startTime: '11:00',
  endDate: '',
  endTime: '13:00',
  wishItemId: null as string | null,
  expectedVersion: 0,
  requestId: REQUEST_ID,
};

const OK_RESPONSE = {
  data: {
    eventId: EVENT_ID,
    version: 1,
    kind: 'date',
    ownerId: null,
    status: 'scheduled',
    allDay: false,
    startsAt: '2026-12-05T02:00:00+00:00',
    endsAt: '2026-12-05T04:00:00+00:00',
    wishItemId: null,
  },
  error: null,
};

describe('saveCalendarEventAction', () => {
  it('요청 키가 UUID가 아니면 RPC를 부르지 않는다', async () => {
    const result = await saveCalendarEventAction({ ...validEvent, requestId: 'retry-me' });
    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('서버에서 다시 검증하고 잘못된 입력이면 RPC를 부르지 않는다', async () => {
    const result = await saveCalendarEventAction({ ...validEvent, title: '', startTime: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(['startTime', 'title']);
    }
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('화면이 보낸 종류가 허용 목록 밖이면 RPC를 부르지 않는다', async () => {
    // 타입을 우회해 보낸 값(조작된 요청)도 서버에서 다시 검증한다.
    const result = await saveCalendarEventAction({
      ...validEvent,
      kind: 'meeting',
    } as unknown as typeof validEvent);
    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('끝나는 시각이 시작보다 앞이면 RPC를 부르지 않는다', async () => {
    const result = await saveCalendarEventAction({ ...validEvent, endTime: '10:00' });
    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('새 일정은 버전 0이어야 한다', async () => {
    const result = await saveCalendarEventAction({ ...validEvent, expectedVersion: 3 });
    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('계약 이름으로 RPC를 부르고 다듬은 값을 보낸다(사용자·공간·소유자 ID는 보내지 않는다)', async () => {
    fake.state.rpcResponse = OK_RESPONSE;
    const result = await saveCalendarEventAction(validEvent);

    expect(result).toEqual({ ok: true, data: { eventId: EVENT_ID, version: 1 } });
    expect(fake.rpc).toHaveBeenCalledWith('save_calendar_event', {
      p_event_id: null,
      p_kind: 'date',
      p_title: '전시 보러 가기',
      p_location: '서울시립미술관',
      p_note: '비밀 메모',
      p_all_day: false,
      p_start_date: '2026-12-05',
      p_start_time: '11:00',
      p_end_date: null,
      p_end_time: '13:00',
      p_wish_item_id: null,
      p_expected_version: 0,
      p_request_id: REQUEST_ID,
    });
    const args = fake.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args)).not.toContain('p_owner_id');
    expect(Object.keys(args)).not.toContain('p_space_id');
    expect(revalidatePath).toHaveBeenCalledWith('/calendar', 'layout');
  });

  it('종일 일정에는 시각을 보내지 않는다', async () => {
    fake.state.rpcResponse = OK_RESPONSE;
    await saveCalendarEventAction({
      ...validEvent,
      allDay: true,
      startTime: '',
      endDate: '2026-12-07',
      endTime: '',
    });
    expect(fake.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_all_day: true,
      p_start_time: null,
      p_end_time: null,
      p_end_date: '2026-12-07',
    });
  });

  it('빈 장소는 null로 보낸다', async () => {
    fake.state.rpcResponse = OK_RESPONSE;
    await saveCalendarEventAction({ ...validEvent, location: '   ' });
    expect(fake.rpc.mock.calls[0]?.[1]).toMatchObject({ p_location: null });
  });

  it('위시 연결을 그대로 보낸다', async () => {
    fake.state.rpcResponse = OK_RESPONSE;
    await saveCalendarEventAction({ ...validEvent, wishItemId: WISH_ID });
    expect(fake.rpc.mock.calls[0]?.[1]).toMatchObject({ p_wish_item_id: WISH_ID });
  });

  it('버전 충돌은 CONFLICT로 돌려주고 캐시를 무효화하지 않는다', async () => {
    fake.state.rpcResponse = {
      data: null,
      error: { code: 'GF409', message: 'CONFLICT', details: '{"expectedVersion":"stale"}' },
    };
    const result = await saveCalendarEventAction({
      ...validEvent,
      eventId: EVENT_ID,
      expectedVersion: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CONFLICT');
      expect(result.stale).toBe(true);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('상대방 개인 일정 수정은 FORBIDDEN이다', async () => {
    fake.state.rpcResponse = {
      data: null,
      error: { code: 'GF403', details: '{"ownerId":"not_owner"}' },
    };
    const result = await saveCalendarEventAction({
      ...validEvent,
      kind: 'personal',
      eventId: EVENT_ID,
      expectedVersion: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('FORBIDDEN');
      expect(result.notOwner).toBe(true);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('응답을 못 받으면(예외) 성공으로 말하지 않고 UNKNOWN을 돌려준다', async () => {
    fake.state.rpcThrows = true;
    const result = await saveCalendarEventAction(validEvent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('계약과 다른 성공 응답은 저장 성공으로 취급하지 않는다', async () => {
    fake.state.rpcResponse = { data: { unexpected: true }, error: null };
    const result = await saveCalendarEventAction(validEvent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('다른 공간의 일정 수정은 NOT_FOUND다(존재 여부를 알리지 않는다)', async () => {
    fake.state.rpcResponse = { data: null, error: { code: 'GF404', details: '{"eventId":"missing"}' } };
    const result = await saveCalendarEventAction({
      ...validEvent,
      eventId: EVENT_ID,
      expectedVersion: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('실패 로그에는 작업 이름·코드·요청 키만 남고 입력값은 없다', async () => {
    fake.state.rpcResponse = { data: null, error: { code: 'GF409', details: '{"expectedVersion":"stale"}' } };
    await saveCalendarEventAction({ ...validEvent, eventId: EVENT_ID, expectedVersion: 2 });
    const logged = errorLog.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
    expect(logged).toContain('calendar.saveCalendarEvent');
    expect(logged).toContain('code=CONFLICT');
    expect(logged).toContain(`requestId=${REQUEST_ID}`);
    expect(logged).not.toContain('비밀 메모');
    expect(logged).not.toContain('전시 보러 가기');
    expect(logged).not.toContain('서울시립미술관');
  });
});

describe('setCalendarEventStatusAction', () => {
  it('상태와 기준 버전을 그대로 보낸다', async () => {
    fake.state.rpcResponse = { data: { eventId: EVENT_ID, version: 2, status: 'done' }, error: null };
    const result = await setCalendarEventStatusAction({
      eventId: EVENT_ID,
      status: 'done',
      expectedVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(result).toEqual({ ok: true, data: { version: 2, status: 'done' } });
    expect(fake.rpc).toHaveBeenCalledWith('set_calendar_event_status', {
      p_event_id: EVENT_ID,
      p_status: 'done',
      p_expected_version: 1,
      p_request_id: REQUEST_ID,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/calendar', 'layout');
  });

  it('취소도 같은 함수로 처리한다(삭제와 다르다)', async () => {
    fake.state.rpcResponse = {
      data: { eventId: EVENT_ID, version: 3, status: 'cancelled' },
      error: null,
    };
    const result = await setCalendarEventStatusAction({
      eventId: EVENT_ID,
      status: 'cancelled',
      expectedVersion: 2,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe('cancelled');
  });

  it('허용 목록 밖의 상태는 RPC 전에 거부한다', async () => {
    const result = await setCalendarEventStatusAction({
      eventId: EVENT_ID,
      status: 'archived',
      expectedVersion: 1,
      requestId: REQUEST_ID,
    } as unknown as Parameters<typeof setCalendarEventStatusAction>[0]);
    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('상대방 개인 일정 완료 처리는 FORBIDDEN이다', async () => {
    fake.state.rpcResponse = { data: null, error: { code: 'GF403', details: '{"ownerId":"not_owner"}' } };
    const result = await setCalendarEventStatusAction({
      eventId: EVENT_ID,
      status: 'done',
      expectedVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORBIDDEN');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('계약과 다른 상태 문자열은 성공으로 취급하지 않는다', async () => {
    fake.state.rpcResponse = {
      data: { eventId: EVENT_ID, version: 2, status: 'archived' },
      error: null,
    };
    const result = await setCalendarEventStatusAction({
      eventId: EVENT_ID,
      status: 'done',
      expectedVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN');
  });
});

describe('deleteCalendarEventAction', () => {
  it('삭제 RPC를 부르고 기준 버전을 그대로 보낸다', async () => {
    fake.state.rpcResponse = { data: { eventId: EVENT_ID }, error: null };
    const result = await deleteCalendarEventAction({
      eventId: EVENT_ID,
      expectedVersion: 4,
      requestId: REQUEST_ID,
    });
    expect(result).toEqual({ ok: true, data: { eventId: EVENT_ID } });
    expect(fake.rpc).toHaveBeenCalledWith('delete_calendar_event', {
      p_event_id: EVENT_ID,
      p_expected_version: 4,
      p_request_id: REQUEST_ID,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/calendar', 'layout');
  });

  it('확인 뒤 상대가 바꿨으면 CONFLICT로 아무것도 지우지 않는다', async () => {
    fake.state.rpcResponse = {
      data: null,
      error: { code: 'GF409', details: '{"expectedVersion":"stale"}' },
    };
    const result = await deleteCalendarEventAction({
      eventId: EVENT_ID,
      expectedVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stale).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('잘못된 ID·버전은 RPC를 부르지 않는다', async () => {
    expect(
      (await deleteCalendarEventAction({ eventId: 'x', expectedVersion: 1, requestId: REQUEST_ID })).ok,
    ).toBe(false);
    expect(
      (await deleteCalendarEventAction({ eventId: EVENT_ID, expectedVersion: 0, requestId: REQUEST_ID }))
        .ok,
    ).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});
