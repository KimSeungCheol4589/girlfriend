import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server Action 단위 테스트.
 *
 * Supabase 클라이언트·세션·캐시 무효화만 가짜로 바꾼다. 확인하는 것:
 *   - 잘못된 입력·요청 키는 RPC를 부르지 않는다(서버에서 다시 검증).
 *   - RPC 인자 이름·값이 CONTRACTS.md 4의 서명과 맞는다. 사용자·공간 ID는 보내지 않는다.
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
  deleteRestaurantAction,
  deleteReviewAction,
  loadMoreRestaurantsAction,
  saveRestaurantAction,
  saveReviewAction,
  setRestaurantStatusAction,
} from '@/features/restaurants/actions';

const REQUEST_ID = '0b0e8d1c-2f3a-4b5c-8d6e-7f8091a2b3c4';
const RESTAURANT_ID = '3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69';
const REVIEW_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

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

const validRestaurant = {
  restaurantId: null,
  name: ' 성수 파스타 ',
  area: '성수',
  category: '양식',
  mapUrl: 'https://map.naver.com/p/1',
  memo: '비밀 메모',
  expectedVersion: 0,
  requestId: REQUEST_ID,
};

describe('saveRestaurantAction', () => {
  it('요청 키가 UUID가 아니면 RPC를 부르지 않는다', async () => {
    const result = await saveRestaurantAction({ ...validRestaurant, requestId: 'retry-me' });
    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('서버에서 다시 검증하고 잘못된 입력이면 RPC를 부르지 않는다', async () => {
    const result = await saveRestaurantAction({ ...validRestaurant, name: '', mapUrl: 'http://map.naver.com/x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(['mapUrl', 'name']);
    }
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('새 맛집은 버전 0이어야 한다', async () => {
    const result = await saveRestaurantAction({ ...validRestaurant, expectedVersion: 3 });
    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('계약 이름으로 RPC를 부르고 다듬은 값을 보낸다(사용자·공간 ID는 보내지 않는다)', async () => {
    fake.state.rpcResponse = {
      data: { restaurantId: RESTAURANT_ID, version: 1, status: 'wishlist' },
      error: null,
    };
    const result = await saveRestaurantAction(validRestaurant);

    expect(result).toEqual({ ok: true, data: { restaurantId: RESTAURANT_ID, version: 1 } });
    expect(fake.rpc).toHaveBeenCalledWith('save_restaurant', {
      p_restaurant_id: null,
      p_name: '성수 파스타',
      p_area: '성수',
      p_category: '양식',
      p_map_url: 'https://map.naver.com/p/1',
      p_memo: '비밀 메모',
      p_expected_version: 0,
      p_request_id: REQUEST_ID,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/restaurants', 'layout');
  });

  it('빈 지도 링크는 null로 보낸다', async () => {
    fake.state.rpcResponse = { data: { restaurantId: RESTAURANT_ID, version: 1 }, error: null };
    await saveRestaurantAction({ ...validRestaurant, mapUrl: '  ' });
    expect(fake.rpc.mock.calls[0]?.[1]).toMatchObject({ p_map_url: null });
  });

  it('버전 충돌은 CONFLICT로 돌려주고 캐시를 무효화하지 않는다', async () => {
    fake.state.rpcResponse = {
      data: null,
      error: { code: 'GF409', message: 'CONFLICT', details: '{"expectedVersion":"stale"}' },
    };
    const result = await saveRestaurantAction({ ...validRestaurant, restaurantId: RESTAURANT_ID, expectedVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CONFLICT');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('응답을 못 받으면(예외) 성공으로 말하지 않고 UNKNOWN을 돌려준다', async () => {
    fake.state.rpcThrows = true;
    const result = await saveRestaurantAction(validRestaurant);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('계약과 다른 성공 응답은 저장 성공으로 취급하지 않는다', async () => {
    fake.state.rpcResponse = { data: { unexpected: true }, error: null };
    const result = await saveRestaurantAction(validRestaurant);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN');
  });

  it('실패 로그에는 작업 이름·코드·요청 키만 남고 입력값은 없다', async () => {
    fake.state.rpcResponse = { data: null, error: { code: 'GF409', details: '{"expectedVersion":"stale"}' } };
    await saveRestaurantAction({ ...validRestaurant, restaurantId: RESTAURANT_ID, expectedVersion: 2 });
    const logged = errorLog.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
    expect(logged).toContain('restaurants.saveRestaurant');
    expect(logged).toContain('code=CONFLICT');
    expect(logged).not.toContain('비밀 메모');
    expect(logged).not.toContain('성수 파스타');
  });
});

describe('setRestaurantStatusAction', () => {
  it('visited는 방문일을 보내고 wishlist는 null과 확인 플래그를 보낸다', async () => {
    fake.state.rpcResponse = {
      data: { restaurantId: RESTAURANT_ID, version: 2, status: 'visited', visitedDate: '2020-01-01', deletedReviewCount: 0 },
      error: null,
    };
    const visited = await setRestaurantStatusAction({
      restaurantId: RESTAURANT_ID,
      status: 'visited',
      visitedDate: '2020-01-01',
      confirmDeleteReviews: false,
      expectedVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(visited.ok).toBe(true);
    expect(fake.rpc).toHaveBeenLastCalledWith('set_restaurant_status', {
      p_restaurant_id: RESTAURANT_ID,
      p_status: 'visited',
      p_visited_date: '2020-01-01',
      p_confirm_delete_reviews: false,
      p_expected_version: 1,
      p_request_id: REQUEST_ID,
    });

    fake.state.rpcResponse = {
      data: { restaurantId: RESTAURANT_ID, version: 3, status: 'wishlist', visitedDate: null, deletedReviewCount: 2 },
      error: null,
    };
    const reverted = await setRestaurantStatusAction({
      restaurantId: RESTAURANT_ID,
      status: 'wishlist',
      visitedDate: null,
      confirmDeleteReviews: true,
      expectedVersion: 2,
      requestId: REQUEST_ID,
    });
    expect(reverted).toEqual({
      ok: true,
      data: { version: 3, status: 'wishlist', visitedDate: null, deletedReviewCount: 2 },
    });
    expect(fake.rpc.mock.calls[1]?.[1]).toMatchObject({ p_visited_date: null, p_confirm_delete_reviews: true });
  });

  it('미래 방문일은 RPC 전에 거부한다', async () => {
    const result = await setRestaurantStatusAction({
      restaurantId: RESTAURANT_ID,
      status: 'visited',
      visitedDate: '2999-01-01',
      confirmDeleteReviews: false,
      expectedVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.visitedDate).toBeTruthy();
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('후기 삭제 확인이 필요하다는 거부를 그대로 알린다', async () => {
    fake.state.rpcResponse = {
      data: null,
      error: { code: 'GF409', details: '{"confirmDeleteReviews":"required"}' },
    };
    const result = await setRestaurantStatusAction({
      restaurantId: RESTAURANT_ID,
      status: 'wishlist',
      visitedDate: null,
      confirmDeleteReviews: false,
      expectedVersion: 2,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.needsReviewConfirmation).toBe(true);
  });
});

describe('deleteRestaurantAction', () => {
  it('확인형 삭제 RPC를 부르고 확인 플래그를 그대로 보낸다', async () => {
    fake.state.rpcResponse = { data: { restaurantId: RESTAURANT_ID, deletedReviewCount: 1 }, error: null };
    const result = await deleteRestaurantAction({
      restaurantId: RESTAURANT_ID,
      confirmDeleteReviews: true,
      expectedVersion: 4,
      requestId: REQUEST_ID,
    });
    expect(result).toEqual({ ok: true, data: { deletedReviewCount: 1 } });
    expect(fake.rpc).toHaveBeenCalledWith('delete_restaurant_confirmed', {
      p_restaurant_id: RESTAURANT_ID,
      p_confirm_delete_reviews: true,
      p_expected_version: 4,
      p_request_id: REQUEST_ID,
    });
    // 확인 없는 이전 함수는 쓰지 않는다.
    expect(fake.rpc.mock.calls.some((call) => call[0] === 'delete_restaurant')).toBe(false);
  });

  it('없는 맛집은 NOT_FOUND다', async () => {
    fake.state.rpcResponse = { data: null, error: { code: 'GF404', details: '{"restaurantId":"missing"}' } };
    const result = await deleteRestaurantAction({
      restaurantId: RESTAURANT_ID,
      confirmDeleteReviews: false,
      expectedVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });
});

describe('후기 Action', () => {
  it('saveReviewAction은 본인 후기 RPC만 부르고 사용자 ID를 보내지 않는다', async () => {
    fake.state.rpcResponse = { data: { reviewId: REVIEW_ID, restaurantId: RESTAURANT_ID, version: 1 }, error: null };
    const result = await saveReviewAction({
      restaurantId: RESTAURANT_ID,
      rating: 5,
      comment: ' 또 가자 ',
      expectedVersion: 0,
      requestId: REQUEST_ID,
    });
    expect(result).toEqual({ ok: true, data: { reviewId: REVIEW_ID, version: 1 } });
    const args = fake.rpc.mock.calls[0]?.[1];
    expect(fake.rpc.mock.calls[0]?.[0]).toBe('save_review');
    expect(args).toEqual({
      p_restaurant_id: RESTAURANT_ID,
      p_rating: 5,
      p_comment: '또 가자',
      p_expected_version: 0,
      p_request_id: REQUEST_ID,
    });
  });

  it('별점이 범위를 벗어나면 RPC를 부르지 않는다', async () => {
    const result = await saveReviewAction({
      restaurantId: RESTAURANT_ID,
      rating: 9,
      comment: '',
      expectedVersion: 0,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('방문 취소와 경쟁해 거부되면 notVisited로 알린다', async () => {
    fake.state.rpcResponse = { data: null, error: { code: 'GF409', details: '{"restaurant":"not_visited"}' } };
    const result = await saveReviewAction({
      restaurantId: RESTAURANT_ID,
      rating: 3,
      comment: '',
      expectedVersion: 0,
      requestId: REQUEST_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.notVisited).toBe(true);
  });

  it('deleteReviewAction은 버전 1 이상과 올바른 ID만 받는다', async () => {
    expect((await deleteReviewAction({ reviewId: 'x', expectedVersion: 1, requestId: REQUEST_ID })).ok).toBe(false);
    expect((await deleteReviewAction({ reviewId: REVIEW_ID, expectedVersion: 0, requestId: REQUEST_ID })).ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();

    fake.state.rpcResponse = { data: { reviewId: REVIEW_ID, restaurantId: RESTAURANT_ID }, error: null };
    const result = await deleteReviewAction({ reviewId: REVIEW_ID, expectedVersion: 2, requestId: REQUEST_ID });
    expect(result.ok).toBe(true);
    expect(fake.rpc).toHaveBeenCalledWith('delete_review', {
      p_review_id: REVIEW_ID,
      p_expected_version: 2,
      p_request_id: REQUEST_ID,
    });
  });
});

describe('loadMoreRestaurantsAction', () => {
  const cursor = { createdAt: '2026-09-21T01:02:03.123456+00:00', id: RESTAURANT_ID };

  it('형식이 틀린 커서는 조회하지 않고 실패로 돌려준다', async () => {
    const result = await loadMoreRestaurantsAction({ filters: {}, cursor: { createdAt: 'x', id: 'y' } });
    expect(result.ok).toBe(false);
    expect(fake.state.queryCalls).toHaveLength(0);
  });

  it('필터·커서·정렬·페이지 크기를 조회에 반영한다', async () => {
    fake.state.queryResponse = { data: [], error: null };
    const result = await loadMoreRestaurantsAction({
      filters: { status: 'visited', q: '100%', area: '성수', category: '' },
      cursor,
    });
    expect(result).toEqual({ ok: true, items: [], nextCursor: null });

    const calls = fake.state.queryCalls;
    expect(calls[0]).toEqual(['from', ['restaurants']]);
    expect(calls).toContainEqual(['eq', ['space_id', 'space-1']]);
    expect(calls).toContainEqual(['eq', ['status', 'visited']]);
    expect(calls).toContainEqual(['eq', ['area', '성수']]);
    expect(calls.some(([method, args]) => method === 'eq' && args[0] === 'category')).toBe(false);
    expect(calls).toContainEqual(['ilike', ['name', '%100\\%%']]);
    expect(calls).toContainEqual([
      'or',
      [
        'created_at.lt."2026-09-21T01:02:03.123456+00:00",and(created_at.eq."2026-09-21T01:02:03.123456+00:00",id.lt.3f1c2b1a-8d4e-4c3b-9a2f-1e2d3c4b5a69)',
      ],
    ]);
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(calls).toContainEqual(['order', ['id', { ascending: false }]]);
    expect(calls).toContainEqual(['limit', [21]]);
  });

  it('조회 오류를 빈 목록으로 바꾸지 않는다', async () => {
    fake.state.queryResponse = { data: null, error: { code: '42501', message: 'permission denied' } };
    const result = await loadMoreRestaurantsAction({ filters: {}, cursor });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain('permission');
  });
});
