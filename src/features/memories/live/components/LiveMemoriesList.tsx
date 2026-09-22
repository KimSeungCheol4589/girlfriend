'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { ErrorNotice } from '@/components/ErrorNotice';
import { MemoryCard } from '@/components/MemoryCard';
import { buildMemoriesHref, hasActiveFilter, type MemoryFilters } from '@/features/memories/filters';
import { formatKoreanMonth } from '@/lib/dates';

import { loadMoreMemoriesAction } from '../../server/actions';
import { toMemoryCardData } from '../card';
import { MEMORY_CODE_MESSAGES } from '../errors';
import type { LiveFilterOptions, LiveMemory, LiveMemoryPage } from '../types';

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex min-h-[36px] items-center rounded-pill border px-3.5 text-sm font-medium transition-colors ${
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
 * 실제 추억 목록.
 *
 * - 첫 페이지는 서버가 렌더한다. "더 보기"는 서버 작업이 세션을 다시 확인하고 다음 20개를 읽는다.
 * - 필터는 URL에만 있고, 필터가 바뀌면 부모가 key를 바꿔 이 컴포넌트를 새로 만든다(커서 초기화).
 * - 더 보기 실패는 이미 보인 목록을 지우지 않고 재시도 버튼을 보여 준다.
 */
export function LiveMemoriesList({
  filters,
  initialPage,
  options,
}: {
  filters: MemoryFilters;
  initialPage: LiveMemoryPage;
  options: LiveFilterOptions | null;
}) {
  const [items, setItems] = useState<LiveMemory[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const filtered = hasActiveFilter(filters);

  const loadMore = async () => {
    if (inFlight.current || !nextCursor) return;
    inFlight.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await loadMoreMemoriesAction({ month: filters.month, tag: filters.tag, cursor: nextCursor });
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...result.data.items.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(result.data.nextCursor);
    } catch {
      setLoadError(MEMORY_CODE_MESSAGES.RETRYABLE_ERROR);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">추억</h1>
          <p className="mt-1 text-sm text-muted">최신 날짜부터 20개씩 보여 줍니다.</p>
        </div>
        <Link href="/memories/new" className="btn-primary">
          새 추억 쓰기
        </Link>
      </div>

      <section aria-labelledby="memory-filters" className="app-card px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="memory-filters" className="text-sm font-bold text-text">
            월·태그로 추리기
          </h2>
          {filtered ? (
            <Link href="/memories" className="btn-quiet !min-h-[32px] !px-3 text-xs">
              필터 지우기
            </Link>
          ) : null}
        </div>

        {options ? (
          <div className="mt-3 space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted">월</p>
              <div className="flex flex-wrap gap-2">
                <FilterChip
                  href={buildMemoriesHref({ ...filters, month: null })}
                  label="전체"
                  active={filters.month === null}
                />
                {options.months.map((month) => (
                  <FilterChip
                    key={month}
                    href={buildMemoriesHref({ ...filters, month: filters.month === month ? null : month })}
                    label={formatKoreanMonth(month)}
                    active={filters.month === month}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted">태그</p>
              {options.tags.length === 0 ? (
                <p className="text-xs text-muted">아직 붙인 태그가 없어요.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <FilterChip
                    href={buildMemoriesHref({ ...filters, tag: null })}
                    label="전체"
                    active={filters.tag === null}
                  />
                  {options.tags.map((tag) => (
                    <FilterChip
                      key={tag}
                      href={buildMemoriesHref({ ...filters, tag: filters.tag === tag ? null : tag })}
                      label={`#${tag}`}
                      active={filters.tag === tag}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted" role="status">
            필터 선택지를 불러오지 못했어요. 목록은 그대로 볼 수 있고, 새로고침하면 다시 불러옵니다.
          </p>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          고른 조건은 주소에 남습니다. 뒤로 가기로 이전 조건으로 돌아갈 수 있어요.
        </p>
      </section>

      {items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="이 조건에 맞는 기록이 없어요"
            description="다른 월이나 태그를 골라 보거나 필터를 지우고 전체를 확인해 보세요."
            action={{ href: '/memories', label: '필터 지우고 전체 보기' }}
          />
        ) : (
          <EmptyState
            title="아직 남긴 기록이 없어요"
            description="사진이 없어도 괜찮아요. 날짜와 짧은 문장부터 적어 두면 나중에 찾기 쉬워집니다."
            action={{ href: '/memories/new', label: '첫 추억 쓰기' }}
          />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="추억 목록">
          {items.map((memory, index) => (
            <li key={memory.id}>
              <MemoryCard memory={toMemoryCardData(memory)} priority={index < 2} />
            </li>
          ))}
        </ul>
      )}

      {loadError ? (
        <ErrorNotice title="다음 기록을 불러오지 못했어요" description={loadError}>
          <button type="button" className="btn-secondary !min-h-[36px] text-xs" onClick={loadMore} disabled={loading}>
            다시 시도
          </button>
        </ErrorNotice>
      ) : null}

      {nextCursor && !loadError ? (
        <div className="flex justify-center">
          <button type="button" className="btn-secondary" onClick={loadMore} disabled={loading} aria-busy={loading}>
            {loading ? '불러오는 중…' : '더 보기'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
