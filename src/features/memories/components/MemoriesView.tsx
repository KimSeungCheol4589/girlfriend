'use client';

import Link from 'next/link';

import { EmptyState } from '@/components/EmptyState';
import { MemoryCard } from '@/components/MemoryCard';
import { formatKoreanMonth } from '@/lib/dates';
import { useDemoStore } from '@/lib/demo/demo-store';
import {
  buildMemoriesHref,
  collectMonthOptions,
  collectTagOptions,
  hasActiveFilter,
  selectMemories,
  type MemoryFilters,
} from '@/features/memories/filters';

function FilterChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-pressed={active}
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

/** 필터는 서버 컴포넌트가 URL에서 읽어 넘긴다. 첫 응답 HTML에도 목록이 담기도록 하기 위해서다. */
export function MemoriesView({ filters }: { filters: MemoryFilters }) {
  const { state } = useDemoStore();
  const memories = state.memories;

  const months = collectMonthOptions(memories);
  const tags = collectTagOptions(memories);
  const visible = selectMemories(memories, filters);
  const filtered = hasActiveFilter(filters);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">추억</h1>
          <p className="mt-1 text-sm text-muted">
            최신 날짜부터 보여 줍니다. 전체 {memories.length}개
            {filtered ? ` 중 ${visible.length}개` : ''}
          </p>
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

        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted">월</p>
            <div className="flex flex-wrap gap-2">
              <FilterChip
                href={buildMemoriesHref({ ...filters, month: null })}
                label="전체"
                active={filters.month === null}
              />
              {months.map((month) => (
                <FilterChip
                  key={month}
                  href={buildMemoriesHref({
                    ...filters,
                    month: filters.month === month ? null : month,
                  })}
                  label={formatKoreanMonth(month)}
                  active={filters.month === month}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted">태그</p>
            {tags.length === 0 ? (
              <p className="text-xs text-muted">아직 붙인 태그가 없어요.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <FilterChip
                  href={buildMemoriesHref({ ...filters, tag: null })}
                  label="전체"
                  active={filters.tag === null}
                />
                {tags.map((tag) => (
                  <FilterChip
                    key={tag}
                    href={buildMemoriesHref({
                      ...filters,
                      tag: filters.tag === tag ? null : tag,
                    })}
                    label={`#${tag}`}
                    active={filters.tag === tag}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          고른 조건은 주소에 남습니다. 뒤로 가기로 이전 조건으로 돌아갈 수 있어요.
        </p>
      </section>

      {visible.length === 0 ? (
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
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((memory, index) => (
            <li key={memory.id}>
              <MemoryCard memory={memory} priority={index < 2} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
