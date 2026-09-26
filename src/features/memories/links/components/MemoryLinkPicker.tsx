'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { ErrorNotice } from '@/components/ErrorNotice';
import { formatKoreanDate } from '@/lib/dates';

import {
  isDefinitiveMemoryResult,
  type MemoryActionResult,
  type MemoryErrorCode,
} from '../../live/errors';
import { createRequestKeyTracker } from '../../live/request-key';
import {
  MEMORY_LINK_SOURCES,
  SOURCE_ICONS,
  SOURCE_PICKER_LABELS,
  sourceDetailHref,
  type MemoryLinkSource,
} from '../constants';
import { LINK_CODE_MESSAGES } from '../errors';
import { linkMemoryPlanAction, loadMoreLinkCandidatesAction } from '../server/actions';
import type { LinkCandidate, LinkMemoryData } from '../types';

/**
 * 기존 추억을 완료한 계획과 연결하는 선택 화면.
 *
 * 규칙
 *   - 후보는 **완료한** 일정·위시만이다(DB도 다시 검사한다).
 *   - 목록을 조용히 자르지 않는다. 더 있으면 "더 보기"로 이어 불러온다.
 *   - 한 계획에 이미 다른 추억이 연결돼 있어도 **막지 않는다**. 그 사실만 알린다.
 *   - 연결은 추억 version을 올린다. 화면이 가진 버전이 낡았으면 충돌을 알리고 다시 불러오게 한다.
 *   - 같은 후보를 다시 눌러 생긴 재시도는 같은 requestId, 다른 후보를 고르면 새 키를 쓴다.
 */
export function MemoryLinkPicker({
  memoryId,
  memoryTitle,
  memoryVersion,
  initialSource,
  initialCandidates,
  initialCursor,
  initialError,
  /** 이미 연결된 원본. 바꾸는 경우 무엇이 사라지는지 알린다. */
  currentSourceId,
}: {
  memoryId: string;
  memoryTitle: string;
  memoryVersion: number;
  initialSource: MemoryLinkSource;
  initialCandidates: LinkCandidate[];
  initialCursor: string | null;
  initialError: string | null;
  currentSourceId: string | null;
}) {
  const router = useRouter();
  const [source, setSource] = useState<MemoryLinkSource>(initialSource);
  const [items, setItems] = useState<LinkCandidate[]>(initialCandidates);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [listError, setListError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ code: MemoryErrorCode; message: string } | null>(null);
  const inFlight = useRef(false);
  const tracker = useRef(createRequestKeyTracker());

  const switchSource = async (next: MemoryLinkSource) => {
    if (next === source || inFlight.current) return;
    setSource(next);
    setProblem(null);
    setLoading(true);
    const result = await loadMoreLinkCandidatesAction({ source: next, cursor: null });
    setLoading(false);
    if (!result.ok) {
      setItems([]);
      setCursor(null);
      setListError(result.message);
      return;
    }
    setItems(result.items);
    setCursor(result.nextCursor);
    setListError(null);
  };

  const loadMore = async () => {
    if (cursor === null || loading || inFlight.current) return;
    setLoading(true);
    const result = await loadMoreLinkCandidatesAction({ source, cursor });
    setLoading(false);
    if (!result.ok) {
      setListError(result.message);
      return;
    }
    setItems((current) => [...current, ...result.items]);
    setCursor(result.nextCursor);
    setListError(null);
  };

  const link = async (candidate: LinkCandidate) => {
    if (inFlight.current) return;
    const input = {
      memoryId,
      source: candidate.source,
      sourceId: candidate.id,
      expectedVersion: memoryVersion,
    };
    const requestId = tracker.current.keyFor(input);

    inFlight.current = true;
    setLinkingId(candidate.id);
    setProblem(null);
    let result: MemoryActionResult<LinkMemoryData>;
    try {
      result = await linkMemoryPlanAction({ ...input, requestId });
    } catch {
      result = { ok: false, code: 'RETRYABLE_ERROR', message: LINK_CODE_MESSAGES.RETRYABLE_ERROR };
    }
    tracker.current.settle(isDefinitiveMemoryResult(result));
    inFlight.current = false;
    setLinkingId(null);

    if (!result.ok) {
      setProblem({ code: result.code, message: result.message });
      return;
    }
    router.replace(`/memories/${memoryId}?notice=linked`);
  };

  const busy = loading || linkingId !== null;

  return (
    <div className="space-y-6">
      <nav aria-label="이동 경로">
        <Link href={`/memories/${memoryId}`} className="btn-quiet !min-h-[36px] !px-2 text-xs">
          <span aria-hidden>←</span> 기록으로 돌아가기
        </Link>
      </nav>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-text">완료한 계획과 연결하기</h1>
        {/* 저장된 제목은 글자로만 그린다. */}
        <p className="text-sm text-muted">
          <span className="font-semibold text-text">{memoryTitle}</span> 기록을 완료한 일정이나 위시와
          연결해요. 계획의 날짜·상태는 바뀌지 않아요.
        </p>
        {currentSourceId ? (
          <p className="text-xs text-muted">
            지금 연결한 계획이 있어요. 다른 계획을 고르면 이전 연결은 사라지고 새 계획으로 바뀝니다.
          </p>
        ) : null}
      </header>

      {problem ? (
        <ErrorNotice title="연결하지 못했어요" description={problem.message}>
          {problem.code === 'CONFLICT' || problem.code === 'NOT_FOUND' ? (
            <button
              type="button"
              className="btn-secondary !min-h-[36px] text-xs"
              onClick={() => {
                setProblem(null);
                router.refresh();
              }}
            >
              최신 내용 불러오기
            </button>
          ) : null}
        </ErrorNotice>
      ) : null}

      <div role="group" aria-label="연결할 계획 종류" className="flex flex-wrap gap-2">
        {MEMORY_LINK_SOURCES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={value === source}
            disabled={busy}
            onClick={() => void switchSource(value)}
            className={value === source ? 'btn-primary !min-h-[40px] text-xs' : 'btn-secondary !min-h-[40px] text-xs'}
          >
            <span aria-hidden>{SOURCE_ICONS[value]}</span> {SOURCE_PICKER_LABELS[value]}
          </button>
        ))}
      </div>

      {listError ? (
        <ErrorNotice title="목록을 불러오지 못했어요" description={listError}>
          <button
            type="button"
            className="btn-secondary !min-h-[36px] text-xs"
            disabled={busy}
            onClick={() => {
              setListError(null);
              void switchSource(source === 'event' ? 'wish' : 'event');
            }}
          >
            다른 종류 보기
          </button>
        </ErrorNotice>
      ) : null}

      {!listError && items.length === 0 ? (
        <p className="app-card px-4 py-6 text-sm text-muted">
          {source === 'event'
            ? '완료로 표시한 일정이 아직 없어요. 캘린더에서 일정을 완료 체크하면 여기에 보여요.'
            : '완료로 표시한 위시가 아직 없어요. 위시 화면에서 완료로 바꾸면 여기에 보여요.'}
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((candidate) => (
            <li
              key={`${candidate.source}:${candidate.id}`}
              className="app-card flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-text">{candidate.title}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {[
                    candidate.date ? formatKoreanDate(candidate.date) : '날짜 없음',
                    candidate.detail,
                  ]
                    .filter((part) => part !== null && part !== '')
                    .join(' · ')}
                  {candidate.linkedMemoryCount > 0
                    ? ` · 이미 연결된 기록 ${candidate.linkedMemoryCount}개`
                    : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <a
                  href={sourceDetailHref(candidate.source, candidate.id)}
                  target="_blank"
                  rel="noopener"
                  className="btn-quiet !min-h-[36px] text-xs"
                >
                  보기
                </a>
                <button
                  type="button"
                  className="btn-primary !min-h-[36px] text-xs"
                  disabled={busy || candidate.id === currentSourceId}
                  onClick={() => void link(candidate)}
                >
                  {linkingId === candidate.id
                    ? '연결하는 중…'
                    : candidate.id === currentSourceId
                      ? '이미 연결됨'
                      : '이 계획과 연결'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {cursor !== null ? (
        <button
          type="button"
          className="btn-secondary w-full"
          disabled={busy}
          onClick={() => void loadMore()}
        >
          {loading ? '불러오는 중…' : '더 보기'}
        </button>
      ) : null}
    </div>
  );
}
