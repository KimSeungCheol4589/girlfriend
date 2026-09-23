import Link from 'next/link';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { MemoryCard } from '@/components/MemoryCard';
import { defaultHomeSections, type HomeSection } from '@/features/customize/sections';
import { toMemoryCardData } from '@/features/memories/live/card';
import { QueryFailure } from '@/features/memories/live/components/QueryFailure';
import {
  getHomeMemorySummary,
  type HomeMemorySummary,
  type QueryFailureCode,
} from '@/features/memories/server/queries';
import { HOME_SECTION_LABELS } from '@/lib/contracts';

/**
 * 로그인한 홈의 섹션 묶음(서버).
 *
 * 고정한 추억과 최근 추억을 사용자 세션 + RLS로 읽는다. 조회 실패는 "추억 없음"으로 바꾸지 않고
 * 실패와 재시도를 보여 준다.
 *
 * 순서·표시 여부는 저장된 꾸미기 설정(`space_settings.home_sections`)을 그대로 따른다(THEME-001).
 * 맛집 섹션은 FOOD-001이 실제 기능을 만드는 중이라 **예시 데이터를 만들지 않고** 준비 중임을 적는다.
 */
export async function LiveMemorySummary({
  sections = defaultHomeSections(),
}: {
  /** 저장된 순서·표시 여부. 주지 않으면 기본 순서(모두 표시)다. */
  sections?: readonly HomeSection[];
}) {
  const visible = sections.filter((section) => section.visible);

  if (visible.length === 0) {
    return (
      <p className="app-card px-5 py-4 text-sm leading-relaxed text-muted">
        홈 섹션을 모두 숨겼습니다. 꾸미기 화면에서 다시 보이게 할 수 있어요.
      </p>
    );
  }

  const needsMemories = visible.some(
    (section) => section.key === 'pinned' || section.key === 'recentMemories',
  );
  const result = needsMemories ? await getHomeMemorySummary() : null;
  const summary = result?.ok ? result.data : null;
  // 추억 조회가 실패해도 **추억 섹션 자리에만** 실패를 알린다. 표시 상태인 다른 섹션은 그대로 그린다.
  const failure = result && !result.ok ? result.code : null;

  return (
    <div className="space-y-8">
      {visible.map((section) => (
        <div key={section.key}>{renderSection(section.key, summary, failure)}</div>
      ))}

      {needsMemories && failure === null ? (
        <div className="flex flex-wrap gap-2">
          <Link href="/memories/new" className="btn-primary">
            새 추억 쓰기
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 섹션 하나를 그린다.
 *
 * 맛집 자리는 추억 요약 데이터를 쓰지 않는다. 그래서 추억 두 섹션을 모두 숨겼거나 추억 조회가
 * 실패한 경우에도 **맛집 섹션은 그대로 보여야 한다.** 요약이 없다고 먼저 빠져나오면 표시로 저장해
 * 둔 섹션이 홈에서 통째로 사라진다.
 */
function renderSection(
  key: HomeSection['key'],
  summary: HomeMemorySummary | null,
  failure: QueryFailureCode | null,
): ReactNode {
  if (key === 'wishlist') return <WishlistSection />;
  if (failure !== null) return <MemorySectionFailure sectionKey={key} code={failure} />;
  if (!summary) return null;
  if (key === 'pinned') return <PinnedSection summary={summary} />;
  return <RecentSection summary={summary} />;
}

/** 추억 섹션 자리의 실패 안내. 표시로 저장된 자리를 비우지 않고 실패를 그대로 알린다. */
function MemorySectionFailure({
  sectionKey,
  code,
}: {
  sectionKey: 'pinned' | 'recentMemories';
  code: QueryFailureCode;
}) {
  return (
    <section aria-labelledby={`section-${sectionKey}`}>
      <h2 id={`section-${sectionKey}`} className="mb-3 text-lg font-bold text-text">
        {HOME_SECTION_LABELS[sectionKey]}
      </h2>
      <QueryFailure code={code} title="추억 요약을 불러오지 못했어요" />
    </section>
  );
}

function PinnedSection({ summary }: { summary: HomeMemorySummary }) {
  return (
    <section aria-labelledby="section-pinned">
      <h2 id="section-pinned" className="mb-3 text-lg font-bold text-text">
        {HOME_SECTION_LABELS.pinned}
      </h2>
      {summary.pinned.length === 0 ? (
        <p className="app-card px-5 py-4 text-sm leading-relaxed text-muted">
          아직 홈에 고정한 추억이 없어요. 추억 상세 화면이나 꾸미기 화면에서 고정하면 여기에 보여 줍니다.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {summary.pinned.map((memory, index) => (
            <li key={memory.id}>
              <MemoryCard memory={toMemoryCardData(memory)} priority={index === 0} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentSection({ summary }: { summary: HomeMemorySummary }) {
  const { pinned, recent } = summary;

  return (
    <section aria-labelledby="section-recent">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 id="section-recent" className="text-lg font-bold text-text">
          {HOME_SECTION_LABELS.recentMemories}
        </h2>
        <Link href="/memories" className="btn-quiet !min-h-[36px] !px-3 text-xs">
          전체 보기<span aria-hidden>→</span>
        </Link>
      </div>
      {recent.length === 0 && pinned.length === 0 ? (
        <EmptyState
          title="첫 기록을 남겨 볼까요?"
          description="사진이 없어도 괜찮아요. 날짜와 짧은 문장만으로도 충분합니다."
          action={{ href: '/memories/new', label: '새 추억 쓰기' }}
        />
      ) : recent.length === 0 ? (
        <p className="app-card px-5 py-4 text-sm text-muted">고정한 추억 말고는 아직 기록이 없어요.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recent.map((memory) => (
            <li key={memory.id}>
              <MemoryCard memory={toMemoryCardData(memory)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 맛집 섹션 자리.
 *
 * 맛집의 실제 저장은 FOOD-001이 만드는 중이다. 여기에서 예시 맛집을 실제 기록처럼 보여 주지 않고
 * 자리와 상태만 알린다. 순서·표시 설정은 이 섹션에도 지금 그대로 적용된다.
 */
function WishlistSection() {
  return (
    <section aria-labelledby="section-wishlist">
      <h2 id="section-wishlist" className="mb-3 text-lg font-bold text-text">
        {HOME_SECTION_LABELS.wishlist}
      </h2>
      <div className="app-card px-5 py-4">
        <span className="chip bg-accent-soft text-text">준비 중</span>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          맛집 목록의 실제 저장은 아직 만드는 중입니다. 저장된 맛집이 없으므로 예시 맛집을 대신 보여
          주지 않아요. 이 섹션의 순서와 표시 여부는 지금도 꾸미기 설정을 따릅니다.
        </p>
        <div className="mt-3">
          <Link href="/restaurants" className="btn-quiet !min-h-[36px] text-xs">
            맛집 화면 열기
          </Link>
        </div>
      </div>
    </section>
  );
}
