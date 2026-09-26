'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorNotice } from '@/components/ErrorNotice';

import {
  isDefinitiveMemoryResult,
  type MemoryActionResult,
  type MemoryErrorCode,
} from '../../live/errors';
import { createRequestKeyTracker } from '../../live/request-key';
import { SOURCE_ICONS, SOURCE_LABELS } from '../constants';
import { LINK_CODE_MESSAGES } from '../errors';
import { unlinkMemoryPlanAction } from '../server/actions';
import { memoryLinkPath } from '../source';
import type { LinkedSourceView, UnlinkMemoryData } from '../types';

/**
 * 추억 상세의 "연결한 계획" 영역.
 *
 * 규칙
 *   - **연결 없음 / 연결 조회 실패**를 구분해 보여 준다. 실패를 "연결 없음"으로 그리지 않는다.
 *   - 원본 제목을 읽지 못해도 연결 자체는 보여 주고, 원본으로 이동할 수 있게 한다.
 *   - 연결 해제는 **명시적 확인**을 받는다. 원본이 지워지는 게 아니라는 점을 문장으로 알린다.
 *   - 해제는 추억 version을 올리므로 성공 뒤 화면을 다시 불러온다.
 */
export function MemoryLinkPanel({
  memoryId,
  memoryVersion,
  view,
  queryError,
}: {
  memoryId: string;
  memoryVersion: number;
  /** 연결이 없으면 null. */
  view: LinkedSourceView | null;
  /** 연결 조회 자체가 실패했을 때의 문장. 있으면 연결 없음으로 그리지 않는다. */
  queryError: string | null;
}) {
  const router = useRouter();
  const [problem, setProblem] = useState<{ code: MemoryErrorCode; message: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const inFlight = useRef(false);
  const tracker = useRef(createRequestKeyTracker());

  const disabled = busy || refreshing;

  const handleUnlink = async () => {
    setConfirmOpen(false);
    if (inFlight.current) return;
    const input = { memoryId, expectedVersion: memoryVersion };
    const requestId = tracker.current.keyFor(input);

    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    let result: MemoryActionResult<UnlinkMemoryData>;
    try {
      result = await unlinkMemoryPlanAction({ ...input, requestId });
    } catch {
      result = { ok: false, code: 'RETRYABLE_ERROR', message: LINK_CODE_MESSAGES.RETRYABLE_ERROR };
    }
    tracker.current.settle(isDefinitiveMemoryResult(result));
    inFlight.current = false;
    setBusy(false);

    if (!result.ok) {
      setProblem({ code: result.code, message: result.message });
      return;
    }
    router.replace(`/memories/${memoryId}?notice=unlinked`);
    startRefresh(() => router.refresh());
  };

  return (
    <section aria-label="연결한 계획" className="space-y-3 border-t border-border pt-5">
      <h2 className="text-sm font-bold text-text">연결한 계획</h2>

      {queryError ? (
        <ErrorNotice title="연결 정보를 불러오지 못했어요" description={queryError}>
          <p className="text-xs">
            연결이 없다는 뜻은 아니에요. 기록과 사진은 그대로 보입니다. 잠시 후 다시 불러와 주세요.
          </p>
          <button
            type="button"
            className="btn-secondary mt-2 !min-h-[36px] text-xs"
            disabled={refreshing}
            onClick={() => startRefresh(() => router.refresh())}
          >
            다시 불러오기
          </button>
        </ErrorNotice>
      ) : null}

      {problem ? (
        <ErrorNotice
          title={problem.code === 'CONFLICT' ? '먼저 바뀐 내용이 있어요' : '연결을 해제하지 못했어요'}
          description={problem.message}
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

      {view ? (
        <div className="app-card space-y-3 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="chip">
              <span aria-hidden>{SOURCE_ICONS[view.link.source]}</span>{' '}
              {SOURCE_LABELS[view.link.source]}
            </span>
            {view.detail && !view.detail.done ? (
              <span>이 계획은 지금 완료 상태가 아니에요.</span>
            ) : null}
          </div>

          {view.detail ? (
            <div className="min-w-0">
              {/* 저장된 문자열은 글자로만 그린다(DESIGN 5.3). */}
              <p className="text-[15px] font-bold leading-snug text-text">{view.detail.title}</p>
              <p className="mt-0.5 text-sm text-muted">{view.detail.summary}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">
              연결한 계획의 내용을 불러오지 못했어요. 연결은 그대로 남아 있습니다.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Link href={view.href} className="btn-secondary !min-h-[36px] text-xs">
              연결한 계획 보기
            </Link>
            <Link href={memoryLinkPath(memoryId)} className="btn-quiet !min-h-[36px] text-xs">
              다른 계획으로 바꾸기
            </Link>
            <button
              type="button"
              className="btn-quiet !min-h-[36px] text-xs"
              disabled={disabled}
              onClick={() => setConfirmOpen(true)}
            >
              {busy ? '해제하는 중…' : '연결 해제'}
            </button>
          </div>
        </div>
      ) : queryError ? null : (
        <div className="app-card flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm text-muted sm:px-5">
          <p>완료한 일정이나 위시와 연결하면 나중에 계획과 기록을 함께 찾을 수 있어요.</p>
          <Link href={memoryLinkPath(memoryId)} className="btn-secondary !min-h-[36px] text-xs">
            완료한 계획과 연결하기
          </Link>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        tone="neutral"
        title="이 연결을 해제할까요?"
        description="기록과 사진, 연결한 일정·위시는 모두 그대로 남습니다. 연결만 사라져요."
        confirmLabel="연결 해제"
        cancelLabel="그대로 두기"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleUnlink}
      />
    </section>
  );
}
