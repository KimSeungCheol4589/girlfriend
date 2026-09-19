'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Photo } from '@/components/Photo';
import { formatKoreanDate, monthKey } from '@/lib/dates';
import { useDemoStore } from '@/lib/demo/demo-store';
import { buildMemoriesHref } from '@/features/memories/filters';
import type { DemoMemory } from '@/lib/demo/types';

function MemoryGallery({ memory }: { memory: DemoMemory }) {
  const [index, setIndex] = useState(0);
  const current = memory.photos[index];

  if (!current) {
    return (
      <div className="app-card flex items-center gap-3 px-5 py-6 text-sm text-muted">
        <span aria-hidden className="text-xl">
          📝
        </span>
        사진 없이 글만 남긴 기록이에요.
      </div>
    );
  }

  return (
    <figure>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card border border-border bg-surface-muted">
        <Photo
          src={current.src}
          alt={current.alt}
          priority
          sizes="(min-width: 768px) 720px, 100vw"
          className="object-contain"
        />
      </div>

      {memory.photos.length > 1 ? (
        <>
          <figcaption className="mt-2 text-xs text-muted">
            {index + 1} / {memory.photos.length}
          </figcaption>
          <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {memory.photos.map((photo, photoIndex) => (
              <li key={photo.id}>
                <button
                  type="button"
                  onClick={() => setIndex(photoIndex)}
                  aria-current={photoIndex === index ? 'true' : undefined}
                  aria-label={`${photoIndex + 1}번째 사진 보기`}
                  className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                    photoIndex === index ? 'border-accent' : 'border-transparent'
                  }`}
                >
                  <Photo src={photo.src} alt="" sizes="64px" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </figure>
  );
}

function MemoryNotFound() {
  return (
    <div className="app-card px-6 py-14 text-center">
      <span aria-hidden className="text-2xl">
        🔍
      </span>
      <h1 className="mt-2 text-xl font-bold text-text">이 기록을 찾지 못했어요</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
        지워졌거나 주소가 잘못됐을 수 있어요. 데모 모드에서는 새로고침하면 추가한 기록이 예시
        데이터로 돌아갑니다.
      </p>
      <Link href="/memories" className="btn-primary mt-6">
        추억 목록으로
      </Link>
    </div>
  );
}

export function MemoryDetailView({ memoryId }: { memoryId: string }) {
  const router = useRouter();
  const { state, deleteMemory, toggleMemoryPin } = useDemoStore();
  const [deleteOpen, setDeleteOpen] = useState(false);
  // 사용자에게는 사람이 읽는 문장만 보여 준다. 오류 코드는 화면에 노출하지 않는다.
  const [actionError, setActionError] = useState<string | null>(null);

  const memory = state.memories.find((item) => item.id === memoryId);
  if (!memory) return <MemoryNotFound />;

  const handleDelete = () => {
    const result = deleteMemory(memory.id);
    setDeleteOpen(false);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    router.push('/memories');
  };

  const handlePin = () => {
    const result = toggleMemoryPin(memory.id);
    if (!result.ok) setActionError(result.message);
  };

  return (
    <div className="space-y-6">
      <nav aria-label="이동 경로">
        <Link href="/memories" className="btn-quiet !min-h-[36px] !px-2 text-xs">
          <span aria-hidden>←</span> 추억 목록
        </Link>
      </nav>

      {actionError ? (
        <ErrorNotice title="요청을 처리하지 못했어요" description={actionError} />
      ) : null}

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <time dateTime={memory.memoryDate}>{formatKoreanDate(memory.memoryDate)}</time>
          {memory.location ? (
            <>
              <span aria-hidden>·</span>
              <span>{memory.location}</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <span>{memory.authorName} 기록</span>
          {memory.isPinned ? (
            <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-xs font-semibold text-text">
              홈에 고정됨
            </span>
          ) : null}
        </div>
        <h1 className="text-2xl font-bold leading-snug text-text sm:text-3xl">{memory.title}</h1>
      </header>

      <MemoryGallery memory={memory} />

      {memory.body ? (
        <div className="app-card px-5 py-5 sm:px-7">
          {/* DESIGN.md 5.3: 본문은 임의 HTML을 해석하지 않고 일반 텍스트로 보여 준다. */}
          <p className="whitespace-pre-wrap text-[15px] leading-[1.9] text-text">{memory.body}</p>
        </div>
      ) : null}

      {memory.tags.length > 0 ? (
        <section aria-label="태그">
          <ul className="flex flex-wrap gap-2">
            {memory.tags.map((tag) => (
              <li key={tag}>
                <Link
                  href={buildMemoriesHref({ month: null, tag })}
                  className="chip hover:bg-accent-soft hover:text-text"
                >
                  #{tag}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-border pt-5">
        <Link href={`/memories/${memory.id}/edit`} className="btn-primary">
          수정
        </Link>
        <button type="button" onClick={handlePin} className="btn-secondary">
          {memory.isPinned ? '홈 고정 해제' : '홈에 고정'}
        </button>
        <Link
          href={buildMemoriesHref({ month: monthKey(memory.memoryDate), tag: null })}
          className="btn-secondary"
        >
          같은 달 기록 보기
        </Link>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="btn-quiet ml-auto text-[#B3261E] hover:bg-[#FDF2F1] hover:text-[#B3261E]"
        >
          삭제
        </button>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        데모 모드라 이 화면의 수정·고정·삭제는 브라우저 메모리에만 반영됩니다. 상대방 화면에는
        전달되지 않아요.
      </p>

      <ConfirmDialog
        open={deleteOpen}
        title="이 기록을 지울까요?"
        description={`‘${memory.title}’과(와) 함께 올린 사진 ${memory.photos.length}장도 같이 사라집니다. 되돌릴 수 없어요.`}
        confirmLabel="삭제"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        details={
          <p className="rounded-xl bg-surface-muted px-3 py-2 text-xs leading-relaxed text-muted">
            데모 모드에서는 이 브라우저 화면에서만 지워집니다. 서버·저장소 삭제는 아직 구현하지
            않았습니다.
          </p>
        }
      />
    </div>
  );
}
