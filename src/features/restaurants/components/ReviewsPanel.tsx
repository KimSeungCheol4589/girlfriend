'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useId, useRef, useState, useTransition } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { validateWith } from '@/features/auth/schemas';

import { deleteReviewAction, saveReviewAction } from '../actions';
import { RESTAURANT_LIMITS, type RestaurantStatus } from '../constants';
import { codePointLength, saveReviewSchema } from '../schema';

import { focusFirstField, FormNotice, type Notice } from './FormNotice';
import { useHydrated } from './use-hydrated';
import { useRestaurantMutation } from './use-restaurant-mutation';

import type { ReviewView } from '../types';

type Report = (notice: Notice, options?: { reload?: boolean }) => void;

/**
 * 두 사람의 별점·한 줄 후기(PROJECT_PLAN 3).
 *
 * - 두 구성원 모두 서로의 후기를 **본다**. 쓰기·수정·삭제는 **본인 것만** 한다.
 *   화면에서 상대 후기에 편집 수단을 두지 않지만, 권한은 DB 함수가 따로 막는다(CONTRACTS.md 4).
 * - 후기는 방문 완료(visited) 맛집에서만 저장된다. 상태 되돌리기와 경쟁하면 DB가 거부한다.
 * - 결과 안내는 이 패널이 들고 있다. 저장 뒤 서버가 새 버전을 그리면 폼은 새 기준으로 다시 시작하지만
 *   안내 문구는 사라지지 않는다.
 */
export function ReviewsPanel({
  restaurantId,
  status,
  reviews,
}: {
  restaurantId: string;
  status: RestaurantStatus;
  reviews: ReviewView[];
}) {
  const router = useRouter();
  const noticeRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showReload, setShowReload] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  const mine = reviews.find((review) => review.isMine) ?? null;
  const others = reviews.filter((review) => !review.isMine);

  const report = useCallback<Report>((next, options) => {
    setNotice(next);
    setShowReload(Boolean(options?.reload));
  }, []);

  return (
    <section aria-labelledby="reviews-heading" className="app-card px-5 py-5 sm:px-6">
      <h2 id="reviews-heading" className="text-base font-bold text-text">
        우리의 후기
      </h2>
      <p className="mt-1 text-sm text-muted">각자 별점과 한 줄 후기를 하나씩 남겨요. 상대방 후기는 볼 수만 있어요.</p>

      <div className="mt-4 space-y-5">
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

        {status === 'visited' ? (
          // 서버가 새 버전을 그리면(저장·새로 고침) 폼을 새 기준으로 다시 시작한다.
          <MyReviewForm
            key={`${mine?.id ?? 'new'}:${mine?.version ?? 0}`}
            restaurantId={restaurantId}
            review={mine}
            report={report}
            noticeRef={noticeRef}
          />
        ) : (
          <p className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-muted">
            ‘다녀왔어요’로 바꾸면 후기를 남길 수 있어요.
          </p>
        )}

        <div>
          <h3 className="text-sm font-bold text-text">상대방 후기</h3>
          {others.length === 0 ? (
            <p className="mt-2 text-sm text-muted">아직 상대방 후기가 없어요.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {others.map((review) => (
                <li key={review.id} className="rounded-xl border border-border px-4 py-3" data-testid="partner-review">
                  <p className="text-sm font-semibold text-text">{review.authorLabel}</p>
                  <RatingText rating={review.rating} />
                  {review.comment ? (
                    <p className="mt-1 whitespace-pre-line break-words text-sm text-text">{review.comment}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function RatingText({ rating }: { rating: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <p className="mt-0.5 text-sm text-accent">
      <span aria-hidden>
        {'★'.repeat(filled)}
        {'☆'.repeat(5 - filled)}
      </span>
      <span className="ml-1 text-muted">별점 {rating}점</span>
    </p>
  );
}

function MyReviewForm({
  restaurantId,
  review,
  report,
  noticeRef,
}: {
  restaurantId: string;
  review: ReviewView | null;
  report: Report;
  noticeRef: React.RefObject<HTMLDivElement | null>;
}) {
  const idPrefix = useId();
  const idFor = (field: string) => `${idPrefix}-${field}`;

  const [rating, setRating] = useState<number | null>(review?.rating ?? null);
  const [comment, setComment] = useState(review?.comment ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const save = useRestaurantMutation('saveReview', saveReviewAction);
  const remove = useRestaurantMutation('deleteReview', deleteReviewAction);
  const busy = save.pending || remove.pending;
  const hydrated = useHydrated();

  // 수정 기준 버전. 새로 쓰는 후기는 0이다(DESIGN 7).
  const expectedVersion = review?.version ?? 0;

  function showFailure(message: string, reload: boolean, errors: Record<string, string> = {}) {
    setFieldErrors(errors);
    report({ tone: 'error', message }, { reload });
    // 렌더 뒤에 포커스를 옮긴다.
    window.setTimeout(() => focusFirstField(errors, idFor, noticeRef.current), 0);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const payload = { restaurantId, rating: rating ?? 0, comment, expectedVersion };
    const checked = validateWith(saveReviewSchema, payload);
    if (!checked.ok) {
      showFailure(Object.values(checked.fieldErrors)[0] ?? '입력을 확인해 주세요.', false, checked.fieldErrors);
      return;
    }

    const result = await save.run(payload);
    if (result === null) return;
    if (result.ok) {
      setFieldErrors({});
      report({ tone: 'success', message: '내 후기를 저장했어요.' });
      return;
    }
    showFailure(
      result.message,
      result.code === 'CONFLICT' || result.code === 'NOT_FOUND',
      result.fieldErrors ?? {},
    );
  }

  const closeConfirm = useCallback(() => setConfirmOpen(false), []);

  async function onDelete() {
    setConfirmOpen(false);
    if (!review || busy) return;
    const result = await remove.run({ reviewId: review.id, expectedVersion: review.version });
    if (result === null) return;
    if (result.ok) {
      report({ tone: 'success', message: '내 후기를 삭제했어요.' });
      return;
    }
    showFailure(result.message, result.code === 'CONFLICT' || result.code === 'NOT_FOUND');
  }

  const commentLength = codePointLength(comment);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-4 rounded-xl border border-border px-4 py-4"
      aria-busy={busy}
    >
      <h3 className="text-sm font-bold text-text">{review ? '내 후기' : '내 후기 남기기'}</h3>

      {/* 하이드레이션 전에는 입력·제출을 막는다(누른 것이 사라지거나 기본 제출되지 않게). */}
      <fieldset disabled={!hydrated} aria-busy={!hydrated || undefined} className="min-w-0 space-y-4 border-0 p-0">
      <legend className="sr-only">내 별점과 한 줄 후기</legend>

      <fieldset aria-describedby={fieldErrors.rating ? `${idFor('rating')}-error` : undefined}>
        <legend className="field-label">별점</legend>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <label
              key={value}
              className={`tap-target min-w-[44px] cursor-pointer rounded-pill border px-3 text-sm font-semibold transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                rating === value
                  ? 'border-accent bg-accent text-accent-contrast'
                  : 'border-border bg-surface text-text hover:bg-surface-muted'
              }`}
            >
              <input
                // 첫 오류 필드 포커스 대상은 첫 번째 별점이다.
                id={value === 1 ? idFor('rating') : undefined}
                type="radio"
                name={`${idPrefix}-rating`}
                value={value}
                checked={rating === value}
                onChange={() => {
                  setRating(value);
                  setFieldErrors((previous) => {
                    const next = { ...previous };
                    delete next.rating;
                    return next;
                  });
                }}
                className="sr-only"
              />
              <span aria-hidden>★</span>
              <span className="ml-1">{value}점</span>
            </label>
          ))}
        </div>
        {fieldErrors.rating ? (
          <p id={`${idFor('rating')}-error`} className="field-error">
            {fieldErrors.rating}
          </p>
        ) : null}
      </fieldset>

      <div>
        <label htmlFor={idFor('comment')} className="field-label">
          한 줄 후기
        </label>
        <input
          id={idFor('comment')}
          type="text"
          value={comment}
          onChange={(event) => {
            setComment(event.target.value);
            if (fieldErrors.comment) {
              setFieldErrors((previous) => {
                const next = { ...previous };
                delete next.comment;
                return next;
              });
            }
          }}
          autoComplete="off"
          className="field-input"
          aria-invalid={fieldErrors.comment ? true : undefined}
          aria-describedby={`${idFor('comment')}-hint${fieldErrors.comment ? ` ${idFor('comment')}-error` : ''}`}
        />
        <p id={`${idFor('comment')}-hint`} className="field-hint">
          {commentLength} / {RESTAURANT_LIMITS.reviewCommentMax}자
        </p>
        {fieldErrors.comment ? (
          <p id={`${idFor('comment')}-error`} className="field-error">
            {fieldErrors.comment}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={busy} aria-busy={save.pending}>
          {save.pending ? '저장 중…' : review ? '내 후기 수정' : '내 후기 저장'}
        </button>
        {review ? (
          <button type="button" className="btn-quiet" disabled={busy} onClick={() => setConfirmOpen(true)}>
            {remove.pending ? '삭제 중…' : '내 후기 삭제'}
          </button>
        ) : null}
      </div>
      </fieldset>

      <ConfirmDialog
        open={confirmOpen}
        title="내 후기를 삭제할까요?"
        description="별점과 한 줄 후기가 함께 지워지고 되돌릴 수 없어요. 상대방 후기는 그대로 남아요."
        confirmLabel="내 후기 삭제"
        onCancel={closeConfirm}
        onConfirm={() => void onDelete()}
      />
    </form>
  );
}
