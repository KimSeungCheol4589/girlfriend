import Link from 'next/link';

import { formatKoreanDate } from '@/lib/dates';

import { safeMapHref } from '../schema';

import { DeleteRestaurantButton } from './DeleteRestaurantButton';
import { ReviewsPanel } from './ReviewsPanel';
import { StatusBadge } from './StatusBadge';
import { VisitStatusPanel } from './VisitStatusPanel';

import type { RestaurantDetail, ReviewView } from '../types';

/**
 * 맛집 상세. 사용자 입력(이름·메모·후기)은 일반 텍스트로만 그린다(DESIGN 5.3).
 * 지도 링크는 허용 호스트의 https 주소일 때만 링크로 만들고 새 창에서 연다.
 */
export function RestaurantDetailView({
  restaurant,
  reviews,
}: {
  restaurant: RestaurantDetail;
  reviews: ReviewView[];
}) {
  const mapHref = safeMapHref(restaurant.mapUrl);

  return (
    <div className="space-y-6">
      <Link href="/restaurants" className="btn-quiet !px-0 text-sm">
        ← 맛집 목록
      </Link>

      <article className="app-card px-5 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <StatusBadge status={restaurant.status} />
          {restaurant.area ? <span className="chip">{restaurant.area}</span> : null}
          {restaurant.category ? <span className="chip">{restaurant.category}</span> : null}
        </div>
        <h1 className="mt-3 break-words text-2xl font-bold text-text">{restaurant.name}</h1>
        {restaurant.status === 'visited' && restaurant.visitedDate ? (
          <p className="mt-1 text-sm text-muted">{formatKoreanDate(restaurant.visitedDate)}에 다녀왔어요</p>
        ) : null}

        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="font-semibold text-text">지도</dt>
            <dd className="mt-0.5 text-muted">
              {mapHref ? (
                <a
                  href={mapHref}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  referrerPolicy="no-referrer"
                  className="break-all text-accent underline underline-offset-2"
                >
                  지도에서 열기
                  <span className="sr-only"> (새 창)</span>
                </a>
              ) : restaurant.mapUrl ? (
                '저장된 링크가 허용된 지도 주소가 아니라 열 수 없어요. 수정 화면에서 다시 넣어 주세요.'
              ) : (
                '등록한 지도 링크가 없어요.'
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-text">메모</dt>
            <dd className="mt-0.5 whitespace-pre-line break-words text-text">
              {restaurant.memo ? restaurant.memo : <span className="text-muted">메모가 없어요.</span>}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-3 border-t border-border pt-4">
          <Link href={`/restaurants/${restaurant.id}/edit`} className="btn-secondary">
            정보 수정
          </Link>
          <DeleteRestaurantButton
            restaurantId={restaurant.id}
            restaurantName={restaurant.name}
            version={restaurant.version}
            reviews={reviews}
          />
        </div>
      </article>

      <VisitStatusPanel
        restaurantId={restaurant.id}
        restaurantName={restaurant.name}
        status={restaurant.status}
        visitedDate={restaurant.visitedDate}
        version={restaurant.version}
        reviews={reviews}
      />

      <ReviewsPanel restaurantId={restaurant.id} status={restaurant.status} reviews={reviews} />
    </div>
  );
}
