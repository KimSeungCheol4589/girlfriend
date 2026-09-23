import Link from 'next/link';

import { EmptyState } from '@/components/EmptyState';

import { RESTAURANT_STATUSES, STATUS_ICONS, STATUS_LABELS } from '../constants';
import { buildRestaurantsHref, filtersKey, hasActiveFilter, type RestaurantFilters } from '../filters';

import { QueryErrorNotice } from './QueryErrorNotice';
import { RestaurantList } from './RestaurantList';
import { RestaurantSearchForm } from './RestaurantSearchForm';

import type { RestaurantPageResult } from '../types';

function StatusTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex min-h-touch items-center rounded-pill border px-4 text-sm font-medium transition-colors ${
        active
          ? 'border-accent bg-accent text-accent-contrast'
          : 'border-border bg-surface text-muted hover:bg-surface-muted hover:text-text'
      }`}
    >
      {label}
    </Link>
  );
}

/**
 * 맛집 목록 화면(서버 컴포넌트).
 *
 * 필터는 URL 검색 매개변수다(DESIGN 3). 검색 폼은 GET으로 제출해 자바스크립트 없이도 동작하고,
 * 뒤로 가기로 이전 필터에 돌아갈 수 있다.
 */
export function RestaurantsListView({
  filters,
  result,
  areaOptions,
  categoryOptions,
}: {
  filters: RestaurantFilters;
  result: RestaurantPageResult;
  areaOptions: string[];
  categoryOptions: string[];
}) {
  const filtered = hasActiveFilter(filters);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">맛집</h1>
          <p className="mt-1 text-sm text-muted">최근에 등록한 곳부터 보여 줘요.</p>
        </div>
        <Link href="/restaurants/new" className="btn-primary">
          맛집 추가
        </Link>
      </div>

      <nav aria-label="방문 상태" className="flex flex-wrap gap-2">
        <StatusTab href={buildRestaurantsHref({ ...filters, status: null })} label="전체" active={filters.status === null} />
        {RESTAURANT_STATUSES.map((status) => (
          <StatusTab
            key={status}
            href={buildRestaurantsHref({ ...filters, status })}
            label={`${STATUS_ICONS[status]} ${STATUS_LABELS[status]}`}
            active={filters.status === status}
          />
        ))}
      </nav>

      <section aria-labelledby="restaurant-search" className="app-card px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="restaurant-search" className="text-sm font-bold text-text">
            이름·지역·종류로 찾기
          </h2>
          {filtered ? (
            <Link href="/restaurants" className="btn-quiet !min-h-[32px] !px-3 text-xs">
              필터 지우기
            </Link>
          ) : null}
        </div>

        {/* key: 필터가 바뀌면 입력칸도 URL 값으로 새로 시작한다. 입력값과 URL 동기화는 폼이 맡는다. */}
        <RestaurantSearchForm
          key={filtersKey(filters)}
          filters={filters}
          areaOptions={areaOptions}
          categoryOptions={categoryOptions}
        />
        <p className="field-hint">지역·음식 종류는 등록한 값과 똑같이 입력해야 찾을 수 있어요.</p>
      </section>

      {!result.ok ? (
        <QueryErrorNotice
          title="맛집 목록을 불러오지 못했어요"
          message={result.message}
          unauthenticated={result.unauthenticated}
          loginNext="/restaurants"
        />
      ) : result.items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="조건에 맞는 맛집이 없어요"
            description="검색어나 지역·종류를 바꿔 보거나 필터를 지워 보세요."
            action={{ href: '/restaurants', label: '필터 지우기' }}
          />
        ) : (
          <EmptyState
            title="아직 등록한 맛집이 없어요"
            description="가고 싶은 곳의 이름과 지도 링크를 저장해 두고 다음 데이트에 골라 보세요."
            action={{ href: '/restaurants/new', label: '첫 맛집 추가' }}
          />
        )
      ) : (
        <RestaurantList
          // 필터가 바뀌거나 서버가 새 첫 페이지를 그리면 커서·추가 목록을 버리고 처음부터 시작한다.
          key={`${filtersKey(filters)}|${result.items.map((item) => item.id).join(',')}`}
          filters={filters}
          initialItems={result.items}
          initialCursor={result.nextCursor}
        />
      )}
    </div>
  );
}
