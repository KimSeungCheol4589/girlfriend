import Link from 'next/link';

import { EmptyState } from '@/components/EmptyState';
import { MemoryCard } from '@/components/MemoryCard';
import { toMemoryCardData } from '@/features/memories/live/card';
import { QueryFailure } from '@/features/memories/live/components/QueryFailure';
import { getHomeMemorySummary } from '@/features/memories/server/queries';
import { HOME_SECTION_LABELS } from '@/lib/contracts';

/**
 * 로그인한 홈의 추억 요약(서버). 고정한 추억과 최근 추억을 사용자 세션 + RLS로 읽는다.
 * 조회 실패는 "추억 없음"으로 바꾸지 않고 실패와 재시도를 보여 준다.
 * 홈 섹션 순서·표시 설정의 실제 저장은 THEME-001 범위라 여기서는 기본 순서로 보여 준다.
 */
export async function LiveMemorySummary() {
  const result = await getHomeMemorySummary();

  if (!result.ok) {
    return (
      <section aria-labelledby="section-memories">
        <h2 id="section-memories" className="mb-3 text-lg font-bold text-text">
          {HOME_SECTION_LABELS.recentMemories}
        </h2>
        <QueryFailure code={result.code} title="추억 요약을 불러오지 못했어요" />
      </section>
    );
  }

  const { pinned, recent } = result.data;

  return (
    <div className="space-y-8">
      <section aria-labelledby="section-pinned">
        <h2 id="section-pinned" className="mb-3 text-lg font-bold text-text">
          {HOME_SECTION_LABELS.pinned}
        </h2>
        {pinned.length === 0 ? (
          <p className="app-card px-5 py-4 text-sm leading-relaxed text-muted">
            아직 홈에 고정한 추억이 없어요. 추억 상세 화면에서 ‘홈에 고정’을 누르면 여기에 보여 줍니다.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pinned.map((memory, index) => (
              <li key={memory.id}>
                <MemoryCard memory={toMemoryCardData(memory)} priority={index === 0} />
              </li>
            ))}
          </ul>
        )}
      </section>

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

      <div className="flex flex-wrap gap-2">
        <Link href="/memories/new" className="btn-primary">
          새 추억 쓰기
        </Link>
      </div>
    </div>
  );
}
