import Link from 'next/link';

import { EmptyState } from '@/components/EmptyState';

import { STATUS_ICONS, STATUS_LABELS, WISH_STATUSES } from '../constants';
import { buildWishesHref, filtersKey, hasActiveFilter, type WishFilters } from '../filters';

import { QueryErrorNotice } from './QueryErrorNotice';
import { WishList } from './WishList';
import { WishSearchForm } from './WishSearchForm';

import type { WishPageResult } from '../types';

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
 * 위시 목록 화면(서버 컴포넌트).
 *
 * 필터는 URL 검색 매개변수다(DESIGN 3). 검색 폼은 GET으로 제출해 자바스크립트 없이도 동작하고,
 * 뒤로 가기로 이전 필터에 돌아갈 수 있다.
 */
export function WishesListView({ filters, result }: { filters: WishFilters; result: WishPageResult }) {
  const filtered = hasActiveFilter(filters);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">하고 싶은 일</h1>
          <p className="mt-1 text-sm text-muted">
            맛집 말고 둘이 함께 하고 싶은 일을 모아 둬요. 최근에 등록한 것부터 보여 줘요.
          </p>
        </div>
        <Link href="/wishes/new" className="btn-primary">
          위시 추가
        </Link>
      </div>

      <nav aria-label="위시 상태" className="flex flex-wrap gap-2">
        <StatusTab href={buildWishesHref({ ...filters, status: null })} label="전체" active={filters.status === null} />
        {WISH_STATUSES.map((status) => (
          <StatusTab
            key={status}
            href={buildWishesHref({ ...filters, status })}
            label={`${STATUS_ICONS[status]} ${STATUS_LABELS[status]}`}
            active={filters.status === status}
          />
        ))}
      </nav>

      <section aria-labelledby="wish-search" className="app-card px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="wish-search" className="text-sm font-bold text-text">
            제목·분류로 찾기
          </h2>
          {filtered ? (
            <Link href="/wishes" className="btn-quiet !min-h-[32px] !px-3 text-xs">
              필터 지우기
            </Link>
          ) : null}
        </div>

        {/* key: 필터가 바뀌면 입력칸도 URL 값으로 새로 시작한다. 입력값과 URL 동기화는 폼이 맡는다. */}
        <WishSearchForm key={filtersKey(filters)} filters={filters} />
      </section>

      {!result.ok ? (
        <QueryErrorNotice
          title="위시 목록을 불러오지 못했어요"
          message={result.message}
          unauthenticated={result.unauthenticated}
          loginNext="/wishes"
        />
      ) : result.items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="조건에 맞는 위시가 없어요"
            description="검색어나 상태·분류를 바꿔 보거나 필터를 지워 보세요."
            action={{ href: '/wishes', label: '필터 지우기' }}
          />
        ) : (
          <EmptyState
            title="아직 적어 둔 위시가 없어요"
            description="언젠가 둘이 함께 하고 싶은 일을 적어 두면 다음 데이트에 골라 볼 수 있어요."
            action={{ href: '/wishes/new', label: '첫 위시 추가' }}
          />
        )
      ) : (
        <WishList
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
