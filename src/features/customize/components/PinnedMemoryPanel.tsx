'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ErrorNotice } from '@/components/ErrorNotice';
import { QueryFailure } from '@/features/memories/live/components/QueryFailure';
import {
  MEMORY_CODE_MESSAGES,
  isDefinitiveMemoryResult,
  type MemoryActionResult,
} from '@/features/memories/live/errors';
import { createRequestKeyTracker, type RequestKeyTracker } from '@/features/memories/live/request-key';
import { loadMoreMemoriesAction, setMemoryPinnedAction } from '@/features/memories/server/actions';
import { formatKoreanDate } from '@/lib/dates';

import { appendPinCandidates, applyPinSaved, toPinCandidate } from '../pin';
import type { PinCandidate, PinCandidatePage, QueryFailureCode } from '../types';

/**
 * 홈에 고정할 추억 고르기.
 *
 * **꾸미기 저장과 별개의 저장이다.** 고정 여부는 기록 행(`memories.is_pinned`)에 있고 기존
 * `setMemoryPinnedAction`(save_memory)으로 한 건씩 바꾼다. 그래서
 *   - 꾸미기 저장 버튼은 고정 상태를 바꾸지 않고, 고정 저장은 테마·커버를 바꾸지 않는다.
 *   - 한쪽이 실패해도 다른 쪽 결과가 달라지지 않는다. 화면도 각각의 성공·실패를 따로 보여 준다.
 * 화면에서 켜고 끈 것은 초안이며, 줄마다 ‘고정 저장’을 눌러야 실제로 바뀐다.
 */

type RowState = { saving: boolean; error: string | null; saved: boolean };

export function PinnedMemoryPanel({
  initial,
  failureCode,
  resetSignal,
  onDirtyChange,
}: {
  initial: PinCandidatePage | null;
  failureCode: QueryFailureCode | null;
  /** 꾸미기 ‘취소’가 눌린 횟수. 바뀌면 **저장하지 않은** 고정 초안만 되돌린다. */
  resetSignal: number;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [candidates, setCandidates] = useState<PinCandidate[]>(initial?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const trackers = useRef(new Map<string, RequestKeyTracker>());
  const firstReset = useRef(resetSignal);

  const dirty = candidates.some(
    (candidate) => drafts[candidate.id] !== undefined && drafts[candidate.id] !== candidate.isPinned,
  );

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (resetSignal === firstReset.current) return;
    firstReset.current = resetSignal;
    // 이미 저장된 고정은 되돌리지 않는다. 저장하지 않은 초안만 지운다.
    setDrafts({});
    setRows({});
  }, [resetSignal]);

  const trackerFor = useCallback((memoryId: string): RequestKeyTracker => {
    const existing = trackers.current.get(memoryId);
    if (existing) return existing;
    const created = createRequestKeyTracker();
    trackers.current.set(memoryId, created);
    return created;
  }, []);

  const desired = (candidate: PinCandidate): boolean => drafts[candidate.id] ?? candidate.isPinned;

  const save = async (candidate: PinCandidate) => {
    const next = desired(candidate);
    if (next === candidate.isPinned) return;

    const tracker = trackerFor(candidate.id);
    // 서버가 렌더한 스냅샷 그대로 + 바뀐 고정 여부. 재시도는 같은 스냅샷·같은 키라 DB가 이전 결과를
    // 재생하고, 그 사이 상대가 저장했으면 버전이 달라 충돌로 거부된다.
    const input = {
      memoryId: candidate.id,
      title: candidate.snapshot.title,
      body: candidate.snapshot.body,
      memoryDate: candidate.snapshot.memoryDate,
      location: candidate.snapshot.location,
      tags: candidate.snapshot.tags,
      photoAssetIds: candidate.snapshot.photoAssetIds,
      isPinned: next,
      expectedVersion: candidate.snapshot.expectedVersion,
    };
    const requestId = tracker.keyFor(input);

    setRows((current) => ({ ...current, [candidate.id]: { saving: true, error: null, saved: false } }));

    let result: MemoryActionResult<{ memoryId: string; version: number }>;
    try {
      result = await setMemoryPinnedAction({ ...input, requestId });
    } catch {
      result = { ok: false, code: 'RETRYABLE_ERROR', message: MEMORY_CODE_MESSAGES.RETRYABLE_ERROR };
    }
    tracker.settle(isDefinitiveMemoryResult(result));

    if (!result.ok) {
      setRows((current) => ({
        ...current,
        [candidate.id]: { saving: false, error: result.message, saved: false },
      }));
      return;
    }

    setCandidates((current) => applyPinSaved(current, candidate.id, next, result.data.version));
    setDrafts((current) => {
      const copy = { ...current };
      delete copy[candidate.id];
      return copy;
    });
    setRows((current) => ({ ...current, [candidate.id]: { saving: false, error: null, saved: true } }));
  };

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const result = await loadMoreMemoriesAction({ month: null, tag: null, cursor });
      if (!result.ok) {
        setLoadMoreError(result.message);
        return;
      }
      setCandidates((current) => appendPinCandidates(current, result.data.items.map(toPinCandidate)));
      setCursor(result.data.nextCursor);
    } catch {
      setLoadMoreError(MEMORY_CODE_MESSAGES.RETRYABLE_ERROR);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section aria-labelledby="pinned-heading" className="app-card px-4 py-5 sm:px-6">
      <h2 id="pinned-heading" className="text-base font-bold text-text">
        홈에 고정할 추억
      </h2>
      <p className="field-hint mt-0.5">
        고정은 <strong>꾸미기 저장과 따로</strong> 저장됩니다. 줄마다 ‘고정 저장’을 눌러야 바뀌고, 아래
        ‘꾸미기 저장’ 버튼은 고정 상태를 건드리지 않아요.
      </p>

      {failureCode ? (
        <div className="mt-4">
          <QueryFailure code={failureCode} title="추억 목록을 불러오지 못했어요" />
        </div>
      ) : candidates.length === 0 ? (
        <p className="mt-4 rounded-xl bg-surface-muted px-4 py-3 text-sm leading-relaxed text-muted">
          아직 기록한 추억이 없어요. 추억을 먼저 쓰면 여기에서 홈에 고정할 수 있습니다.
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-2">
            {candidates.map((candidate) => {
              const next = desired(candidate);
              const changed = next !== candidate.isPinned;
              const row = rows[candidate.id];
              return (
                <li key={candidate.id} className="rounded-xl border border-border px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text">{candidate.title}</p>
                      <p className="text-[11px] text-muted">
                        <time dateTime={candidate.memoryDate}>{formatKoreanDate(candidate.memoryDate)}</time>
                        {candidate.isPinned ? ' · 저장된 상태: 고정됨' : ' · 저장된 상태: 고정 안 함'}
                      </p>
                    </div>

                    <button
                      type="button"
                      aria-pressed={next}
                      onClick={() =>
                        setDrafts((current) => ({ ...current, [candidate.id]: !next }))
                      }
                      className={`tap-target rounded-pill border px-3 text-xs font-semibold ${
                        next ? 'border-accent bg-accent-soft text-text' : 'border-border text-muted'
                      }`}
                    >
                      {next ? '홈에 고정' : '고정 안 함'}
                    </button>

                    <button
                      type="button"
                      onClick={() => void save(candidate)}
                      disabled={!changed || row?.saving}
                      className="btn-secondary !min-h-[36px] text-xs"
                    >
                      {row?.saving ? '저장하는 중…' : '고정 저장'}
                    </button>
                  </div>

                  {changed && !row?.saving ? (
                    <p className="mt-1.5 text-[11px] font-semibold text-muted">
                      아직 저장하지 않은 고정 변경이에요.
                    </p>
                  ) : null}
                  {row?.saved && !changed ? (
                    <p role="status" className="mt-1.5 text-[11px] text-muted">
                      이 추억의 고정 상태만 저장했어요.
                    </p>
                  ) : null}
                  {row?.error ? <p className="field-error mt-1.5">{row.error}</p> : null}
                </li>
              );
            })}
          </ul>

          {cursor ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="btn-quiet !min-h-[36px] text-xs"
              >
                {loadingMore ? '불러오는 중…' : '추억 더 보기'}
              </button>
              <p className="field-hint mt-1">
                고정한 추억은 목록 맨 앞에 모두 보여 줍니다. 더 보기로 예전 기록도 고를 수 있어요.
              </p>
            </div>
          ) : null}

          {loadMoreError ? (
            <div className="mt-3">
              <ErrorNotice title="더 불러오지 못했어요" description={loadMoreError} />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
