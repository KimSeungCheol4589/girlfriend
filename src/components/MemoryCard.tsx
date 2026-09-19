import Link from 'next/link';

import { Photo } from '@/components/Photo';
import { formatKoreanDate } from '@/lib/dates';
import type { DemoMemory } from '@/lib/demo/types';

/**
 * 목록용 추억 카드.
 * DESIGN.md 4.1: 사진 첫 장을 대표 이미지로 쓰고, 사진이 없으면 날짜·제목 카드로 대신한다.
 */
export function MemoryCard({ memory, priority = false }: { memory: DemoMemory; priority?: boolean }) {
  const cover = memory.photos[0];

  return (
    <article className="app-card group overflow-hidden transition-shadow focus-within:shadow-raised hover:shadow-raised">
      {/* 전역 :focus-visible 외곽선을 덮지 않는다. 목록에서 키보드 이동의 주요 수단이다. */}
      <Link href={`/memories/${memory.id}`} className="block">
        {cover ? (
          <div className="relative aspect-[4/3] w-full bg-surface-muted">
            <Photo src={cover.src} alt={cover.alt} priority={priority} />
            {memory.photos.length > 1 ? (
              <span className="absolute right-3 top-3 rounded-pill bg-[#2B2522]/65 px-2.5 py-1 text-[11px] font-semibold text-white">
                사진 {memory.photos.length}장
              </span>
            ) : null}
          </div>
        ) : (
          <div className="flex aspect-[4/3] w-full flex-col justify-end gap-1 bg-surface-muted px-5 py-4">
            <span className="text-xs font-semibold text-muted">사진 없는 기록</span>
            <span className="text-lg font-bold leading-snug text-text">{memory.title}</span>
          </div>
        )}

        <div className="px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <time dateTime={memory.memoryDate}>{formatKoreanDate(memory.memoryDate)}</time>
            {memory.location ? (
              <>
                <span aria-hidden>·</span>
                <span>{memory.location}</span>
              </>
            ) : null}
            {memory.isPinned ? (
              <span className="rounded-pill bg-accent-soft px-2 py-0.5 font-semibold text-text">
                홈에 고정
              </span>
            ) : null}
          </div>

          <h3 className="mt-1.5 line-clamp-2 text-base font-bold leading-snug text-text">
            {memory.title}
          </h3>

          {memory.body ? (
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{memory.body}</p>
          ) : null}

          {memory.tags.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {memory.tags.map((tag) => (
                <li key={tag} className="chip">
                  #{tag}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Link>
    </article>
  );
}
