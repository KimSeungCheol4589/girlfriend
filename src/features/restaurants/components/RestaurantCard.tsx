import Link from 'next/link';

import { formatKoreanDate } from '@/lib/dates';

import { StatusBadge } from './StatusBadge';

import type { RestaurantListItem } from '../types';

/** 목록 카드. 이름·지역·종류는 일반 텍스트로만 그린다. */
export function RestaurantCard({ restaurant }: { restaurant: RestaurantListItem }) {
  return (
    <Link
      href={`/restaurants/${restaurant.id}`}
      className="app-card block px-4 py-4 transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={restaurant.status} />
        {restaurant.area ? <span className="chip">{restaurant.area}</span> : null}
        {restaurant.category ? <span className="chip">{restaurant.category}</span> : null}
      </div>
      <h3 className="mt-2 break-words text-base font-bold text-text">{restaurant.name}</h3>
      {restaurant.status === 'visited' && restaurant.visitedDate ? (
        <p className="mt-1 text-xs text-muted">{formatKoreanDate(restaurant.visitedDate)} 방문</p>
      ) : null}
    </Link>
  );
}
