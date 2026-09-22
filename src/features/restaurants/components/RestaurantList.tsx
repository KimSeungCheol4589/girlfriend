'use client';

import { useState } from 'react';

import { ErrorNotice } from '@/components/ErrorNotice';

import { loadMoreRestaurantsAction } from '../actions';

import { RestaurantCard } from './RestaurantCard';
import { useHydrated } from './use-hydrated';

import type { RestaurantCursor, RestaurantFilters } from '../filters';
import type { RestaurantListItem } from '../types';

/**
 * 목록과 "더 보기".
 *
 * - 정렬·커서는 `created_at DESC, id DESC`(DESIGN 3). 필터가 바뀌면 부모가 key를 바꿔 처음부터 시작한다.
 * - 더 보기 실패는 "끝"으로 표시하지 않는다. 같은 커서로 다시 시도할 수 있게 남긴다.
 * - 같은 맛집이 두 번 붙지 않게 ID로 거른다(새로 추가된 항목과 겹칠 때 대비).
 */
export function RestaurantList({
  filters,
  initialItems,
  initialCursor,
}: {
  filters: RestaurantFilters;
  initialItems: RestaurantListItem[];
  initialCursor: RestaurantCursor | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadMoreRestaurantsAction({
        filters: {
          status: filters.status ?? undefined,
          q: filters.q,
          area: filters.area,
          category: filters.category,
        },
        cursor,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...result.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(result.nextCursor);
    } catch {
      setError('목록을 더 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="맛집 목록" data-testid="restaurant-list">
        {items.map((item) => (
          <li key={item.id}>
            <RestaurantCard restaurant={item} />
          </li>
        ))}
      </ul>

      {error ? (
        <ErrorNotice title="더 불러오지 못했어요" description={error}>
          <button type="button" className="btn-primary" onClick={() => void loadMore()} disabled={loading}>
            다시 시도
          </button>
        </ErrorNotice>
      ) : null}

      {cursor && !error ? (
        <div className="flex justify-center">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void loadMore()}
            // 하이드레이션 전에는 눌러도 아무 일이 없으므로 막는다.
            disabled={loading || !hydrated}
            aria-busy={loading}
          >
            {loading ? '불러오는 중…' : '더 보기'}
          </button>
        </div>
      ) : null}

      {!cursor && items.length > 0 ? (
        <p className="text-center text-xs text-muted" role="status">
          목록 끝이에요.
        </p>
      ) : null}
    </div>
  );
}
