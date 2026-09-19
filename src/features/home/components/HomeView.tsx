'use client';

import Link from 'next/link';

import { CoverPanel } from '@/components/CoverPanel';
import { EmptyState } from '@/components/EmptyState';
import { MemoryCard } from '@/components/MemoryCard';
import { Photo } from '@/components/Photo';
import { HOME_SECTION_LABELS, type HomeSectionKey } from '@/lib/contracts';
import { formatKoreanDate } from '@/lib/dates';
import { useDemoStore } from '@/lib/demo/demo-store';
import { sortMemoriesLatestFirst } from '@/features/memories/filters';
import type { DemoMemory, DemoRestaurant } from '@/lib/demo/types';

function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-lg font-bold text-text">{title}</h2>
      {action ? (
        <Link href={action.href} className="btn-quiet !min-h-[36px] !px-3 text-xs">
          {action.label}
          <span aria-hidden>→</span>
        </Link>
      ) : null}
    </div>
  );
}

function PinnedSection({ memory }: { memory: DemoMemory | undefined }) {
  if (!memory) {
    return (
      <section aria-labelledby="section-pinned">
        <h2 id="section-pinned" className="sr-only">
          {HOME_SECTION_LABELS.pinned}
        </h2>
        <EmptyState
          title="아직 홈에 고정한 추억이 없어요"
          description="추억 상세 화면에서 '홈에 고정'을 누르면 이 자리에 크게 보여 줍니다."
          action={{ href: '/memories', label: '추억 목록 보기' }}
        />
      </section>
    );
  }

  const cover = memory.photos[0];

  return (
    <section aria-labelledby="section-pinned">
      <SectionHeading title={HOME_SECTION_LABELS.pinned} />
      <article className="app-card overflow-hidden md:flex">
        {cover ? (
          <div className="relative aspect-[4/3] w-full bg-surface-muted md:aspect-auto md:w-1/2">
            <Photo
              src={cover.src}
              alt={cover.alt}
              priority
              sizes="(min-width: 768px) 520px, 100vw"
            />
          </div>
        ) : null}
        <div className="flex flex-1 flex-col justify-center gap-2 px-5 py-5 sm:px-7">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded-pill bg-accent-soft px-2 py-0.5 font-semibold text-text">
              홈에 고정
            </span>
            <time dateTime={memory.memoryDate}>{formatKoreanDate(memory.memoryDate)}</time>
            {memory.location ? <span>· {memory.location}</span> : null}
          </div>
          <h3 className="text-xl font-bold leading-snug text-text">{memory.title}</h3>
          <p className="line-clamp-3 text-sm leading-relaxed text-muted">{memory.body}</p>
          <Link href={`/memories/${memory.id}`} className="btn-secondary mt-2 w-fit">
            이 기록 자세히 보기
          </Link>
        </div>
      </article>
    </section>
  );
}

function RecentMemoriesSection({ memories }: { memories: DemoMemory[] }) {
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

      {memories.length === 0 ? (
        <EmptyState
          title="첫 기록을 남겨 볼까요?"
          description="사진이 없어도 괜찮아요. 날짜와 짧은 문장만으로도 충분합니다."
          action={{ href: '/memories/new', label: '새 추억 쓰기' }}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {memories.map((memory, index) => (
            <li key={memory.id}>
              <MemoryCard memory={memory} priority={index === 0} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WishlistSection({ restaurants }: { restaurants: DemoRestaurant[] }) {
  return (
    <section aria-labelledby="section-wishlist">
      <SectionHeading
        title={HOME_SECTION_LABELS.wishlist}
        action={{ href: '/restaurants', label: '맛집 화면' }}
      />

      {restaurants.length === 0 ? (
        <EmptyState
          title="저장한 맛집이 아직 없어요"
          description="맛집 저장 기능은 다음 작업에서 만듭니다."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {restaurants.map((restaurant) => (
            <li key={restaurant.id} className="app-card px-4 py-3.5">
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="rounded-pill bg-surface-muted px-2 py-0.5 font-semibold">
                  가고 싶은 곳
                </span>
                <span>{restaurant.area}</span>
                <span aria-hidden>·</span>
                <span>{restaurant.category}</span>
              </div>
              <h3 className="mt-1.5 text-base font-bold text-text">{restaurant.name}</h3>
              <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">
                {restaurant.memo}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted">
        맛집 등록·방문 체크·후기는 아직 만들지 않았습니다. 위 목록은 화면 확인용 예시입니다.
      </p>
    </section>
  );
}

export function HomeView() {
  const { state } = useDemoStore();
  const { space, customization, coverPreview, memories, restaurants } = state;

  const sorted = sortMemoriesLatestFirst(memories);
  const pinned = sorted.find((memory) => memory.isPinned);
  const recent = sorted.filter((memory) => memory.id !== pinned?.id).slice(0, 3);
  const wishlist = restaurants.filter((restaurant) => restaurant.status === 'wishlist').slice(0, 3);

  const renderSection = (key: HomeSectionKey) => {
    switch (key) {
      case 'pinned':
        return <PinnedSection key={key} memory={pinned} />;
      case 'recentMemories':
        return <RecentMemoriesSection key={key} memories={recent} />;
      case 'wishlist':
        return <WishlistSection key={key} restaurants={wishlist} />;
      default:
        return null;
    }
  };

  const visibleSections = customization.sections.filter((section) => section.visible);

  return (
    <div className="space-y-8">
      <CoverPanel space={space} coverPreview={coverPreview} />

      {visibleSections.length === 0 ? (
        <EmptyState
          title="홈에 표시할 섹션이 모두 꺼져 있어요"
          description="꾸미기 화면에서 보고 싶은 섹션을 다시 켤 수 있습니다."
          action={{ href: '/customize', label: '꾸미기로 이동' }}
        />
      ) : (
        visibleSections.map((section) => renderSection(section.key))
      )}

      <div className="flex flex-wrap gap-2">
        <Link href="/memories/new" className="btn-primary">
          새 추억 쓰기
        </Link>
        <Link href="/customize" className="btn-secondary">
          홈 꾸미기
        </Link>
      </div>
    </div>
  );
}
