'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useId, useRef, useState, useTransition } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatKoreanDate, todayInSeoul } from '@/lib/dates';

import { setRestaurantStatusAction } from '../actions';
import { STATUS_ICONS, STATUS_LABELS, type RestaurantStatus } from '../constants';
import { confirmedActionMessage } from '../errors';
import { visitedDateProblem } from '../schema';

import { FormNotice, type Notice } from './FormNotice';
import { ReviewDeletionList } from './ReviewDeletionList';
import { useHydrated } from './use-hydrated';
import { useRestaurantMutation } from './use-restaurant-mutation';

import type { ReviewView } from '../types';

/**
 * 방문 상태·방문일(DESIGN 5.3).
 *
 * - visited ↔ 방문일은 항상 함께 바뀐다. 방문일은 한국 달력 기준 오늘까지만.
 * - visited → wishlist: 후기가 있으면 **삭제될 후기를 보여 주고 확인을 받은 뒤에만** 확인 플래그를 보낸다.
 * - 기준 버전은 서버가 이 화면을 그릴 때의 값이다. 후기 저장·수정·삭제도 맛집 버전을 올리므로,
 *   확인 창에 보인 뒤 후기가 생기거나 바뀌거나 지워졌으면 DB가 CONFLICT로 아무것도 바꾸지 않는다.
 *   그때는 최신 내용을 불러와 다시 확인을 받는다.
 */
export function VisitStatusPanel({
  restaurantId,
  restaurantName,
  status,
  visitedDate,
  version,
  reviews,
}: {
  restaurantId: string;
  restaurantName: string;
  status: RestaurantStatus;
  visitedDate: string | null;
  version: number;
  reviews: ReviewView[];
}) {
  const router = useRouter();
  const dateId = useId();
  const noticeRef = useRef<HTMLDivElement>(null);
  const [date, setDate] = useState(visitedDate ?? todayInSeoul());
  const [dateError, setDateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showReload, setShowReload] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const { run, pending } = useRestaurantMutation('setRestaurantStatus', setRestaurantStatusAction);
  const hydrated = useHydrated();

  // 서버가 **다른** 방문일을 그렸을 때만(내 저장 또는 새로 고침) 입력값을 맞춘다.
  // 이전에는 마운트 직후 effect가 항상 다시 설정해 사용자가 막 고른 날짜를 덮어쓸 수 있었다(1차 E2E 분석).
  const [syncedVisitedDate, setSyncedVisitedDate] = useState(visitedDate);
  if (syncedVisitedDate !== visitedDate) {
    setSyncedVisitedDate(visitedDate);
    setDate(visitedDate ?? todayInSeoul());
  }

  const today = todayInSeoul();

  async function submit(next: RestaurantStatus, confirmDeleteReviews: boolean) {
    setShowReload(false);
    if (next === 'visited') {
      const problem = visitedDateProblem(date, todayInSeoul());
      if (problem) {
        setDateError(problem);
        setNotice(null);
        document.getElementById(dateId)?.focus();
        return;
      }
    }
    setDateError(null);

    const result = await run({
      restaurantId,
      status: next,
      visitedDate: next === 'visited' ? date : null,
      confirmDeleteReviews,
      expectedVersion: version,
    });
    if (result === null) return;

    if (result.ok) {
      const deleted = result.data.deletedReviewCount;
      setNotice({
        tone: 'success',
        message:
          result.data.status === 'visited'
            ? `${formatKoreanDate(result.data.visitedDate ?? date)}에 다녀온 곳으로 저장했어요.`
            : deleted > 0
              ? `가고 싶은 곳으로 되돌리고 후기 ${deleted}개를 삭제했어요.`
              : '가고 싶은 곳으로 되돌렸어요.',
      });
      return;
    }

    if (result.fieldErrors?.visitedDate) {
      setDateError(result.fieldErrors.visitedDate);
      document.getElementById(dateId)?.focus();
    }
    setNotice({ tone: 'error', message: confirmedActionMessage(result) });
    if (result.code === 'NOT_FOUND') setShowReload(true);
    // 버전 충돌·확인 필요: 아무것도 바뀌지 않았다. 최신 상태(후기 목록·버전)를 바로 불러와 다시 확인받는다.
    // 이 패널에는 방문일 말고 사용자 입력이 없어 새로 고침으로 잃는 내용이 없다.
    if (result.code === 'CONFLICT') startRefresh(() => router.refresh());
    noticeRef.current?.focus();
  }

  const closeConfirm = useCallback(() => setConfirmOpen(false), []);

  function onRevert() {
    if (reviews.length > 0) {
      setConfirmOpen(true);
      return;
    }
    void submit('wishlist', false);
  }

  return (
    <section aria-labelledby={`${dateId}-heading`} className="app-card px-5 py-5 sm:px-6">
      <h2 id={`${dateId}-heading`} className="text-base font-bold text-text">
        방문 기록
      </h2>
      <p className="mt-1 text-sm text-muted">
        지금 상태:{' '}
        <strong className="font-semibold text-text">
          <span aria-hidden>{STATUS_ICONS[status]} </span>
          {STATUS_LABELS[status]}
        </strong>
        {status === 'visited' && visitedDate ? ` · ${formatKoreanDate(visitedDate)} 방문` : null}
      </p>

      <div className="mt-4">
        <FormNotice ref={noticeRef} notice={notice}>
          {showReload ? (
            <button
              type="button"
              className="btn-secondary !min-h-[36px] !px-3 text-xs"
              disabled={refreshing}
              onClick={() => startRefresh(() => router.refresh())}
            >
              {refreshing ? '불러오는 중…' : '최신 내용 불러오기'}
            </button>
          ) : null}
        </FormNotice>
      </div>

      {/* 하이드레이션 전에는 날짜 입력과 버튼을 막는다(누른 것이 조용히 사라지지 않게). */}
      <fieldset
        disabled={!hydrated}
        aria-busy={!hydrated || undefined}
        className="mt-3 flex min-w-0 flex-wrap items-end gap-3 border-0 p-0"
      >
        <legend className="sr-only">방문 상태 바꾸기</legend>
        <div className="min-w-[12rem]">
          <label htmlFor={dateId} className="field-label">
            방문일
          </label>
          <input
            id={dateId}
            type="date"
            value={date}
            max={today}
            onChange={(event) => {
              setDate(event.target.value);
              setDateError(null);
            }}
            className="field-input"
            aria-invalid={dateError ? true : undefined}
            aria-describedby={dateError ? `${dateId}-error` : `${dateId}-hint`}
          />
          {dateError ? (
            <p id={`${dateId}-error`} className="field-error">
              {dateError}
            </p>
          ) : (
            <p id={`${dateId}-hint`} className="field-hint">
              한국 날짜 기준 오늘까지 고를 수 있어요.
            </p>
          )}
        </div>

        {status === 'wishlist' ? (
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void submit('visited', false)}
          >
            {pending ? '저장 중…' : '다녀왔어요'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={pending || date === visitedDate}
              aria-busy={pending}
              onClick={() => void submit('visited', false)}
            >
              {pending ? '저장 중…' : '방문일 저장'}
            </button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={onRevert}>
              가고 싶은 곳으로 되돌리기
            </button>
          </>
        )}
      </fieldset>

      <ConfirmDialog
        open={confirmOpen}
        title={`‘${restaurantName}’을(를) 가고 싶은 곳으로 되돌릴까요?`}
        description={`방문일과 함께 후기 ${reviews.length}개가 삭제돼요. 삭제한 후기는 되돌릴 수 없어요.`}
        details={<ReviewDeletionList reviews={reviews} />}
        confirmLabel={`후기 ${reviews.length}개 삭제하고 되돌리기`}
        onCancel={closeConfirm}
        onConfirm={() => {
          setConfirmOpen(false);
          void submit('wishlist', true);
        }}
      />
    </section>
  );
}
