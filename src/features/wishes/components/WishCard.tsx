import Link from 'next/link';

import { formatKoreanDate } from '@/lib/dates';

import { CategoryBadge, StatusBadge } from './Badges';

import type { WishListItem } from '../types';

/** 목록 카드. 제목은 일반 텍스트로만 그린다. */
export function WishCard({ wish }: { wish: WishListItem }) {
  return (
    <Link
      href={`/wishes/${wish.id}`}
      className="app-card block px-4 py-4 transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={wish.status} />
        <CategoryBadge category={wish.category} />
      </div>
      <h3 className="mt-2 break-words text-base font-bold text-text">{wish.title}</h3>
      {wish.plannedDate ? (
        <p className="mt-1 text-xs text-muted">
          {wish.status === 'done' ? `${formatKoreanDate(wish.plannedDate)}에 했어요` : `${formatKoreanDate(wish.plannedDate)} 예정`}
        </p>
      ) : null}
    </Link>
  );
}
