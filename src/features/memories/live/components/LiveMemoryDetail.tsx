'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorNotice } from '@/components/ErrorNotice';
import { buildMemoriesHref } from '@/features/memories/filters';
import { formatKoreanDate, monthKey } from '@/lib/dates';

import { MemoryLinkPanel } from '../../links/components/MemoryLinkPanel';
import type { LinkedSourceView } from '../../links/types';
import { deleteMemoryAction, setMemoryPinnedAction } from '../../server/actions';
import { memoryPhotoUrl } from '../constants';
import {
  MEMORY_CODE_MESSAGES,
  isDefinitiveMemoryResult,
  type MemoryActionResult,
  type MemoryErrorCode,
} from '../errors';
import { createRequestKeyTracker } from '../request-key';
import type { LiveMemory } from '../types';

export type DetailNotice =
  | 'saved'
  | 'saved-cleanup-pending'
  | 'saved-linked'
  | 'saved-linked-cleanup-pending'
  | 'linked'
  | 'unlinked'
  | null;

/** 저장·연결 결과 안내. 무엇이 끝났는지 나눠서 적는다(부분 성공을 뭉개지 않는다). */
const NOTICE_MESSAGES: Record<Exclude<DetailNotice, null>, string> = {
  saved: '저장했어요. 상대방이 이 화면을 새로 열면 같은 내용이 보입니다.',
  'saved-cleanup-pending':
    '저장했어요. 상대방이 이 화면을 새로 열면 같은 내용이 보입니다. 뺀 사진 파일 정리는 끝나지 않아 나중에 다시 정리합니다(다른 사람에게는 보이지 않아요).',
  'saved-linked': '저장하고 계획과 연결했어요. 상대방이 이 화면을 새로 열면 같은 내용이 보입니다.',
  'saved-linked-cleanup-pending':
    '저장하고 계획과 연결했어요. 뺀 사진 파일 정리는 끝나지 않아 나중에 다시 정리합니다(다른 사람에게는 보이지 않아요).',
  linked: '계획과 연결했어요. 계획의 날짜·상태는 바뀌지 않았습니다.',
  unlinked: '연결을 해제했어요. 기록과 사진, 계획은 모두 그대로 있습니다.',
};

function LivePhoto({ assetId, alt, priority, sizes, className }: {
  assetId: string;
  alt: string;
  priority?: boolean;
  sizes: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-muted">
        사진을 불러오지 못했어요.
        <button
          type="button"
          className="btn-quiet !min-h-[32px] text-xs"
          onClick={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          다시 불러오기
        </button>
      </div>
    );
  }

  // 인증된 사진 경로를 그대로 쓴다. 이미지 최적화 서버를 거치지 않는다(no-store 응답을 캐시하지 않도록).
  return (
    <Image
      key={attempt}
      src={memoryPhotoUrl(assetId)}
      alt={alt}
      fill
      unoptimized
      sizes={sizes}
      priority={priority}
      className={className ?? 'object-cover'}
      onError={() => setFailed(true)}
    />
  );
}

function Gallery({ memory }: { memory: LiveMemory }) {
  const [index, setIndex] = useState(0);
  const current = memory.photos[index] ?? memory.photos[0];

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

  const currentIndex = memory.photos.indexOf(current);

  return (
    <figure>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card border border-border bg-surface-muted">
        <LivePhoto
          key={current.assetId}
          assetId={current.assetId}
          alt={`${memory.title} 사진 ${currentIndex + 1}`}
          priority
          sizes="(min-width: 768px) 720px, 100vw"
          className="object-contain"
        />
      </div>
      {memory.photos.length > 1 ? (
        <>
          <figcaption className="mt-2 text-xs text-muted">
            {currentIndex + 1} / {memory.photos.length}
          </figcaption>
          <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {memory.photos.map((photo, photoIndex) => (
              <li key={photo.assetId}>
                <button
                  type="button"
                  onClick={() => setIndex(photoIndex)}
                  aria-current={photoIndex === currentIndex ? 'true' : undefined}
                  aria-label={`${photoIndex + 1}번째 사진 보기`}
                  className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                    photoIndex === currentIndex ? 'border-accent' : 'border-transparent'
                  }`}
                >
                  <LivePhoto assetId={photo.assetId} alt="" sizes="64px" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </figure>
  );
}

type Problem = { code: MemoryErrorCode; message: string };

/**
 * 실제 추억 상세. 고정·삭제는 서버 작업으로만 하고, 성공 응답을 받은 뒤에만 화면을 바꾼다.
 * 버전이 바뀌었으면(상대방이 먼저 저장) 충돌을 알리고 최신 내용을 다시 불러오게 한다.
 */
export function LiveMemoryDetail({
  memory,
  authorName,
  notice,
  linkView,
  linkQueryError,
}: {
  memory: LiveMemory;
  authorName: string;
  notice: DetailNotice;
  /** 연결한 계획. 없으면 null. */
  linkView: LinkedSourceView | null;
  /** 연결 조회 자체가 실패했을 때의 문장. "연결 없음"과 구분한다. */
  linkQueryError: string | null;
}) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState<'pin' | 'delete' | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const inFlight = useRef(false);
  const pinTracker = useRef(createRequestKeyTracker());
  const deleteTracker = useRef(createRequestKeyTracker());

  const run = async <T,>(
    kind: 'pin' | 'delete',
    call: () => Promise<MemoryActionResult<T>>,
    tracker: ReturnType<typeof createRequestKeyTracker>,
  ): Promise<MemoryActionResult<T> | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(kind);
    setProblem(null);
    let result: MemoryActionResult<T>;
    try {
      result = await call();
    } catch {
      result = { ok: false, code: 'RETRYABLE_ERROR', message: MEMORY_CODE_MESSAGES.RETRYABLE_ERROR };
    }
    tracker.settle(isDefinitiveMemoryResult(result));
    inFlight.current = false;
    setBusy(null);
    if (!result.ok) setProblem({ code: result.code, message: result.message });
    return result;
  };

  const handlePin = async () => {
    // 화면이 렌더한 스냅샷 그대로 보낸다. 재시도는 같은 스냅샷·같은 키라 DB가 이전 결과를 재생하고,
    // 그 사이 상대가 저장했으면 버전이 달라 충돌로 거부된다(상대 수정을 덮지 않는다).
    const input = {
      memoryId: memory.id,
      title: memory.title,
      body: memory.body,
      memoryDate: memory.memoryDate,
      location: memory.location ?? '',
      tags: memory.tags,
      photoAssetIds: memory.photos.map((photo) => photo.assetId),
      isPinned: !memory.isPinned,
      expectedVersion: memory.version,
    };
    const requestId = pinTracker.current.keyFor(input);
    const result = await run('pin', () => setMemoryPinnedAction({ ...input, requestId }), pinTracker.current);
    if (result?.ok) startRefresh(() => router.refresh());
  };

  const handleDelete = async () => {
    setDeleteOpen(false);
    const input = { memoryId: memory.id, expectedVersion: memory.version };
    const requestId = deleteTracker.current.keyFor(input);
    const result = await run('delete', () => deleteMemoryAction({ ...input, requestId }), deleteTracker.current);
    if (result?.ok) {
      const next = result.data.cleanup === 'pending' ? 'deleted-cleanup-pending' : 'deleted';
      router.replace(`/memories?notice=${next}`);
    }
  };

  const disabled = busy !== null || refreshing;

  return (
    <div className="space-y-6">
      <nav aria-label="이동 경로">
        <Link href="/memories" className="btn-quiet !min-h-[36px] !px-2 text-xs">
          <span aria-hidden>←</span> 추억 목록
        </Link>
      </nav>

      {notice ? (
        <p role="status" className="rounded-card border border-border bg-surface-muted px-4 py-3 text-sm text-text">
          {NOTICE_MESSAGES[notice]}
        </p>
      ) : null}

      {problem ? (
        <ErrorNotice
          title={problem.code === 'CONFLICT' ? '상대방이 먼저 바꿨어요' : '요청을 처리하지 못했어요'}
          description={
            problem.code === 'CONFLICT'
              ? '이 화면이 보여 주는 내용이 최신이 아닙니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.'
              : problem.message
          }
        >
          {problem.code === 'CONFLICT' || problem.code === 'NOT_FOUND' ? (
            <button
              type="button"
              className="btn-secondary !min-h-[36px] text-xs"
              disabled={refreshing}
              onClick={() => {
                setProblem(null);
                startRefresh(() => router.refresh());
              }}
            >
              최신 내용 불러오기
            </button>
          ) : null}
        </ErrorNotice>
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
          <span>{authorName} 기록</span>
          {memory.isPinned ? (
            <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-xs font-semibold text-text">
              홈에 고정됨
            </span>
          ) : null}
        </div>
        <h1 className="text-2xl font-bold leading-snug text-text sm:text-3xl">{memory.title}</h1>
      </header>

      <Gallery memory={memory} />

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
                <Link href={buildMemoriesHref({ month: null, tag })} className="chip hover:bg-accent-soft hover:text-text">
                  #{tag}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <MemoryLinkPanel
        memoryId={memory.id}
        memoryVersion={memory.version}
        view={linkView}
        queryError={linkQueryError}
      />

      <div className="flex flex-wrap gap-2 border-t border-border pt-5">
        <Link href={`/memories/${memory.id}/edit`} className="btn-primary">
          수정
        </Link>
        <button type="button" onClick={handlePin} className="btn-secondary" disabled={disabled}>
          {busy === 'pin' ? '저장하는 중…' : memory.isPinned ? '홈 고정 해제' : '홈에 고정'}
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
          disabled={disabled}
          className="btn-quiet ml-auto text-[#B3261E] hover:bg-[#FDF2F1] hover:text-[#B3261E]"
        >
          {busy === 'delete' ? '지우는 중…' : '삭제'}
        </button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="이 기록을 지울까요?"
        description={
          `‘${memory.title}’과(와) 함께 붙은 사진 ${memory.photos.length}장도 같이 지워집니다. ` +
          '두 사람 모두에게서 사라지고 되돌릴 수 없어요.' +
          // DESIGN 5.3: 추억을 지워도 연결한 일정·위시는 유지된다.
          (linkView ? ' 연결한 일정·위시는 지워지지 않고 그대로 남아요.' : '')
        }
        confirmLabel="삭제"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
