import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 위시 Server Action 단위 테스트.
 *
 * Supabase 클라이언트·세션·캐시 무효화만 가짜로 바꾼다. 확인하는 것:
 *   - 잘못된 입력·요청 키는 RPC를 부르지 않는다(서버에서 다시 검증).
 *   - RPC 이름·인자가 마이그레이션의 서명과 맞는다. 사용자·공간 ID는 보내지 않는다.
 *   - 실패는 코드·문장으로만 돌려주고, 저장 여부를 모르면 성공으로 말하지 않는다.
 *   - 캐시 무효화는 성공했을 때만 한다.
 *   - 로그에 사용자 입력이 들어가지 않는다.
 */

const fake = vi.hoisted(() => {
  type Response = { data: unknown; error: { code?: string; message?: string; details?: string } | null };
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
    for (const method of ['select', 'eq', 'ilike', 'or', 'order', 'limit', 'maybeSingle']) {
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
  deleteWishAction,
  loadMoreWishesAction,
  saveWishAction,
  setWishStatusAction,
} from '@/features/wishes/actions';

const REQUEST_ID = '0b0e8d1c-2f3a-4b5c-8d6e-7f8091a2b3c4';
const WISH_ID = '3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69';

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

const validWish = {
  wishId: null as string | null,
  title: ' 한강 야경 보기 ',
  category: 'activity' as const,
  memo: '비밀 메모',
  linkUrl: 'https://example.invalid/night',
  expectedVersion: 0,
  requestId: REQUEST_ID,
};

describe('saveWishAction', () => {
  it('요청 키가 UUID가 아니면 RPC를 부르지 않는다', async () => {
    const result = await saveWishAction({ ...validWish, requestId: 'retry-me' });
    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('서버에서 다시 검증하고 잘못된 입력이면 RPC를 부르지 않는다', async () => {
    const result = await saveWishAction({
      ...validWish,
      title: '',
      linkUrl: 'http://example.invalid/x',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(['linkUrl', 'title']);
    }
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('화면이 보낸 분류가 허용 목록 밖이면 RPC를 부르지 않는다', async () => {
    // 타입을 우회해 보낸 값(조작된 요청)도 서버에서 다시 검증한다.
    const result = await saveWishAction({
      ...validWish,
      category: 'restaurant',
    } as unknown as typeof validWish);
    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('새 위시는 버전 0이어야 한다', async () => {
    const result = await saveWishAction({ ...validWish, expectedVersion: 3 });
    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('계약 이름으로 RPC를 부르고 다듬은 값을 보낸다(사용자·공간 ID는 보내지 않는다)', async () => {
    fake.state.rpcResponse = {
      data: { wishId: WISH_ID, version: 1, status: 'wish', category: 'activity' },
      error: null,
    };
    const result = await saveWishAction(validWish);

    expect(result).toEqual({ ok: true, data: { wishId: WISH_ID, version: 1 } });
    expect(fake.rpc).toHaveBeenCalledWith('save_wish', {
      p_wish_id: null,
      p_title: '한강 야경 보기',
      p_category: 'activity',
      p_memo: '비밀 메모',
      p_link_url: 'https://example.invalid/night',
      p_expected_version: 0,
      p_request_id: REQUEST_ID,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/wishes', 'layout');
  });

  it('빈 링크는 null로 보낸다', async () => {
    fake.state.rpcResponse = { data: { wishId: WISH_ID, version: 1 }, error: null };
    await saveWishAction({ ...validWish, linkUrl: '   ' });
    expect(fake.rpc.mock.calls[0]?.[1]).toMatchObject({ p_link_url: null });
  });

  it('버전 충돌은 CONFLICT로 돌려주고 캐시를 무효화하지 않는다', async () => {
    fake.state.rpcResponse = {
      data: null,
      error: { code: 'GF409', message: 'CONFLICT', details: '{"expectedVersion":"stale"}' },
    };
    const result = await saveWishAction({ ...validWish, wishId: WISH_ID, expectedVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CONFLICT');
      expect(result.stale).toBe(true);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('응답을 못 받으면(예외) 성공으로 말하지 않고 UNKNOWN을 돌려준다', async () => {
    fake.state.rpcThrows = true;
    const result = await saveWishAction(validWish);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('계약과 다른 성공 응답은 저장 성공으로 취급하지 않는다', async () => {
    fake.state.rpcResponse = { data: { unexpected: true }, error: null };
    const result = await saveWishAction(validWish);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('다른 공간의 위시 수정은 NOT_FOUND다(존재 여부를 알리지 않는다)', async () => {
    fake.state.rpcResponse = { data: null, error: { code: 'GF404', details: '{"wishId":"missing"}' } };
    const result = await saveWishAction({ ...validWish, wishId: WISH_ID, expectedVersion: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('실패 로그에는 작업 이름·코드·요청 키만 남고 입력값은 없다', async () => {
    fake.state.rpcResponse = { data: null, error: { code: 'GF409', details: '{"expectedVersion":"stale"}' } };
    await saveWishAction({ ...validWish, wishId: WISH_ID, expectedVersion: 2 });
    const logged = errorLog.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
    expect(logged).toContain('wishes.saveWish');
    expect(logged).toContain('code=CONFLICT');
    expect(logged).toContain(`requestId=${REQUEST_ID}`);
    expect(logged).not.toContain('비밀 메모');
    expect(logged).not.toContain('한강 야경 보기');
  });
});

describe('setWishStatusAction', () => {
  it('계획됨은 계획일을 보내고 하고 싶음은 반드시 null을 보낸다', async () => {
    fake.state.rpcResponse = {
      data: { wishId: WISH_ID, version: 2, status: 'planned', plannedDate: '2099-01-01' },
      error: null,
    };
    const planned = await setWishStatusAction({
      wishId: WISH_ID,
      status: 'planned',
      plannedDate: '2099-01-01',
      expectedVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(planned).toEqual({
      ok: true,
      data: { version: 2, status: 'planned', plannedDate: '2099-01-01' },
    });
    expect(fake.rpc).toHaveBeenLastCalledWith('set_wish_status', {
      p_wish_id: WISH_ID,
      p_status: 'planned',
      p_planned_date: '2099-01-01',
      p_expected_version: 1,
      p_request_id: REQUEST_ID,
    });

    fake.state.rpcResponse = {
      data: { wishId: WISH_ID, version: 3, status: 'wish', plannedDate: null },
      error: null,
    };
    const reverted = await setWishStatusAction({
      wishId: WISH_ID,
      status: 'wish',
      plannedDate: null,
      expectedVersion: 2,
      requestId: REQUEST_ID,
    });
    expect(reverted).toEqual({ ok: true, data: { version: 3, status: 'wish', plannedDate: null } });
    expect(fake.rpc.mock.calls[1]?.[1]).toMatchObject({ p_planned_date: null });
  });

  it('계획일 없이 상태만 바꿀 수 있다', async () => {
    fake.state.rpcResponse = {
      data: { wishId: WISH_ID, version: 2, status: 'done', plannedDate: null },
      error: null,
    };
    const result = await setWishStatusAction({
      wishId: WISH_ID,
      status: 'done',
      plannedDate: null,
      expectedVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(true);
    expect(fake.rpc.mock.calls[0]?.[1]).toMatchObject({ p_planned_date: null });
  });

  it('미래 계획일은 정상이다(맛집 방문일과 다른 점)', async () => {
    fake.state.rpcResponse = {
      data: { wishId: WISH_ID, version: 2, status: 'planned', plannedDate: '2099-12-31' },
      error: null,
    };
    const result = await setWishStatusAction({
      wishId: WISH_ID,
      status: 'planned',
      plannedDate: '2099-12-31',
      expectedVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(true);
  });

  it('하고 싶음에 계획일을 함께 보내면 RPC 전에 거부한다', async () => {
    const result = await setWishStatusAction({
      wishId: WISH_ID,
      status: 'wish',
      plannedDate: '2099-01-01',
      expectedVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.plannedDate).toBeTruthy();
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('형식이 틀린 날짜는 RPC 전에 거부한다', async () => {
    const result = await setWishStatusAction({
      wishId: WISH_ID,
      status: 'planned',
      plannedDate: '2026-02-30',
      expectedVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('계약과 다른 상태 문자열은 성공으로 취급하지 않는다', async () => {
    fake.state.rpcResponse = {
      data: { wishId: WISH_ID, version: 2, status: 'archived', plannedDate: null },
      error: null,
    };
    const result = await setWishStatusAction({
      wishId: WISH_ID,
      status: 'done',
      plannedDate: null,
      expectedVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN');
  });
});

describe('deleteWishAction', () => {
  it('삭제 RPC를 부르고 기준 버전을 그대로 보낸다', async () => {
    fake.state.rpcResponse = { data: { wishId: WISH_ID }, error: null };
    const result = await deleteWishAction({ wishId: WISH_ID, expectedVersion: 4, requestId: REQUEST_ID });
    expect(result).toEqual({ ok: true, data: { wishId: WISH_ID } });
    expect(fake.rpc).toHaveBeenCalledWith('delete_wish', {
      p_wish_id: WISH_ID,
      p_expected_version: 4,
      p_request_id: REQUEST_ID,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/wishes', 'layout');
  });

  it('확인 뒤 상대가 바꿨으면 CONFLICT로 아무것도 지우지 않는다', async () => {
    fake.state.rpcResponse = { data: null, error: { code: 'GF409', details: '{"expectedVersion":"stale"}' } };
    const result = await deleteWishAction({ wishId: WISH_ID, expectedVersion: 1, requestId: REQUEST_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stale).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('없는 위시는 NOT_FOUND다', async () => {
    fake.state.rpcResponse = { data: null, error: { code: 'GF404', details: '{"wishId":"missing"}' } };
    const result = await deleteWishAction({ wishId: WISH_ID, expectedVersion: 1, requestId: REQUEST_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('잘못된 ID·버전은 RPC를 부르지 않는다', async () => {
    expect((await deleteWishAction({ wishId: 'x', expectedVersion: 1, requestId: REQUEST_ID })).ok).toBe(
      false,
    );
    expect(
      (await deleteWishAction({ wishId: WISH_ID, expectedVersion: 0, requestId: REQUEST_ID })).ok,
    ).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});

describe('loadMoreWishesAction', () => {
  const cursor = { createdAt: '2026-09-23T01:02:03.123456+00:00', id: WISH_ID };

  it('형식이 틀린 커서는 조회하지 않고 실패로 돌려준다', async () => {
    const result = await loadMoreWishesAction({ filters: {}, cursor: { createdAt: 'x', id: 'y' } });
    expect(result.ok).toBe(false);
    expect(fake.state.queryCalls).toHaveLength(0);
  });

  it('필터·커서·정렬·페이지 크기를 조회에 반영한다', async () => {
    fake.state.queryResponse = { data: [], error: null };
    const result = await loadMoreWishesAction({
      filters: { status: 'planned', category: 'trip', q: '100%' },
      cursor,
    });
    expect(result).toEqual({ ok: true, items: [], nextCursor: null });

    const calls = fake.state.queryCalls;
    expect(calls[0]).toEqual(['from', ['wish_items']]);
    expect(calls).toContainEqual(['eq', ['space_id', 'space-1']]);
    expect(calls).toContainEqual(['eq', ['status', 'planned']]);
    expect(calls).toContainEqual(['eq', ['category', 'trip']]);
    expect(calls).toContainEqual(['ilike', ['title', '%100\\%%']]);
    expect(calls).toContainEqual([
      'or',
      [
        'created_at.lt."2026-09-23T01:02:03.123456+00:00",and(created_at.eq."2026-09-23T01:02:03.123456+00:00",id.lt.3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69)',
      ],
    ]);
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(calls).toContainEqual(['order', ['id', { ascending: false }]]);
    expect(calls).toContainEqual(['limit', [21]]);
  });

  it('알 수 없는 필터 값은 조건으로 쓰지 않는다', async () => {
    await loadMoreWishesAction({ filters: { status: 'archived', category: 'restaurant' }, cursor });
    const calls = fake.state.queryCalls;
    expect(calls.some(([method, args]) => method === 'eq' && args[0] === 'status')).toBe(false);
    expect(calls.some(([method, args]) => method === 'eq' && args[0] === 'category')).toBe(false);
  });

  it('조회 오류를 빈 목록으로 바꾸지 않는다', async () => {
    fake.state.queryResponse = { data: null, error: { code: '42501', message: 'permission denied' } };
    const result = await loadMoreWishesAction({ filters: {}, cursor });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain('permission');
  });
});
