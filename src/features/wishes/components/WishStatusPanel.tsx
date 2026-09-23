'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';

import { formatKoreanDate } from '@/lib/dates';

import { setWishStatusAction } from '../actions';
import { STATUS_ICONS, STATUS_LABELS, WISH_STATUSES, type WishStatus } from '../constants';
import { plannedDateProblem } from '../schema';

import { FormNotice, type Notice } from './FormNotice';
import { useHydrated } from './use-hydrated';
import { useWishMutation } from './use-wish-mutation';

/**
 * 상태(하고 싶어요 · 계획했어요 · 해냈어요)와 계획한 날짜.
 *
 * - 맛집 방문일과 달리 계획일은 **미래 날짜가 정상**이다. 앞으로 할 일이기 때문이다.
 * - 계획일은 선택이다. 비워 두고 상태만 바꿔도 된다.
 * - `하고 싶어요`로 되돌리면 계획한 날짜가 지워진다(DB도 같은 규칙으로 비운다).
 * - 기준 버전은 서버가 이 화면을 그릴 때의 값이다. 그 사이 상대방이 바꿨으면 DB가 CONFLICT로
 *   아무것도 바꾸지 않는다. 그때는 최신 내용을 다시 불러온다.
 */
export function WishStatusPanel({
  wishId,
  status,
  plannedDate,
  version,
}: {
  wishId: string;
  status: WishStatus;
  plannedDate: string | null;
  version: number;
}) {
  const router = useRouter();
  const panelId = useId();
  const dateId = `${panelId}-date`;
  const noticeRef = useRef<HTMLDivElement>(null);
  const [date, setDate] = useState(plannedDate ?? '');
  const [dateError, setDateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showReload, setShowReload] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const { run, pending } = useWishMutation('setWishStatus', setWishStatusAction);
  const hydrated = useHydrated();

  /**
   * 입력칸과 서버 값 맞추기.
   *
   * 저장에 성공하면 서버가 다시 그린 결과가 **조금 뒤에** 도착한다. 그 사이 사용자가 새 날짜를
   * 입력하면 늦게 도착한 값이 그 입력을 덮어써 버린다(저장 직후 날짜를 다시 고칠 때 실제로 겪는다).
   *
   * 그래서 "prop이 실제로 바뀌었을 때"만 맞추고, 사용자가 손댄 뒤에는 덮어쓰지 않는다.
   *   - `propSnapshot`: 직전에 본 prop. 이것과 달라졌을 때만 서버가 바뀐 것이다.
   *   - `serverDate`: 서버가 가진 값(우리가 아는 한). 저장 성공 응답으로도 갱신한다.
   *   - `dirtyRef`: 마지막 저장 뒤 사용자가 입력을 고쳤는지. 고쳤으면 서버 값으로 되돌리지 않는다.
   *     (상대방이 바꾼 값과 충돌하면 저장할 때 CONFLICT로 분명히 알려 준다.)
   */
  const [serverDate, setServerDate] = useState(plannedDate);
  const [propSnapshot, setPropSnapshot] = useState(plannedDate);
  const dirtyRef = useRef(false);

  if (propSnapshot !== plannedDate) {
    setPropSnapshot(plannedDate);
    setServerDate(plannedDate);
    if (!dirtyRef.current) setDate(plannedDate ?? '');
  }

  async function submit(next: WishStatus) {
    setShowReload(false);

    // 'wish'로 되돌릴 때는 계획일을 보내지 않는다(DB도 비운다).
    let nextDate: string | null = null;
    if (next !== 'wish') {
      const trimmed = date.trim();
      if (trimmed !== '') {
        const problem = plannedDateProblem(trimmed);
        if (problem) {
          setDateError(problem);
          setNotice(null);
          document.getElementById(dateId)?.focus();
          return;
        }
        nextDate = trimmed;
      }
    }
    setDateError(null);

    const result = await run({
      wishId,
      status: next,
      plannedDate: nextDate,
      expectedVersion: version,
    });
    if (result === null) return;

    if (result.ok) {
      const saved = result.data.plannedDate;
      // 저장이 끝났으므로 사용자의 "고친 상태"를 지우고, 서버가 확정한 값을 그대로 보여 준다.
      dirtyRef.current = false;
      setServerDate(saved);
      setDate(saved ?? '');
      setNotice({
        tone: 'success',
        message:
          result.data.status === 'wish'
            ? '하고 싶어요로 되돌렸어요. 계획한 날짜는 지웠어요.'
            : result.data.status === 'planned'
              ? saved
                ? `${formatKoreanDate(saved)}에 하기로 저장했어요.`
                : '계획했어요로 저장했어요. 날짜는 나중에 정해도 돼요.'
              : saved
                ? `${formatKoreanDate(saved)}에 해낸 일로 저장했어요.`
                : '해낸 일로 저장했어요.',
      });
      return;
    }

    if (result.fieldErrors?.plannedDate) {
      setDateError(result.fieldErrors.plannedDate);
      document.getElementById(dateId)?.focus();
    }
    setNotice({ tone: 'error', message: result.message });
    if (result.code === 'NOT_FOUND') setShowReload(true);
    // 버전 충돌: 아무것도 바뀌지 않았다. 최신 상태·버전을 바로 불러온다.
    // 이 패널에는 계획일 말고 사용자 입력이 없어 새로 고침으로 잃는 내용이 없다.
    if (result.code === 'CONFLICT') startRefresh(() => router.refresh());
    noticeRef.current?.focus();
  }

  return (
    <section aria-labelledby={`${panelId}-heading`} className="app-card px-5 py-5 sm:px-6">
      <h2 id={`${panelId}-heading`} className="text-base font-bold text-text">
        계획과 상태
      </h2>
      <p className="mt-1 text-sm text-muted">
        지금 상태:{' '}
        <strong className="font-semibold text-text">
          <span aria-hidden>{STATUS_ICONS[status]} </span>
          {STATUS_LABELS[status]}
        </strong>
        {plannedDate ? ` · ${formatKoreanDate(plannedDate)}` : null}
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
        className="mt-3 min-w-0 border-0 p-0"
      >
        <legend className="sr-only">상태 바꾸기</legend>

        <div className="max-w-[16rem]">
          <label htmlFor={dateId} className="field-label">
            계획한 날짜 <span className="ml-1 text-xs font-normal text-muted">(선택)</span>
          </label>
          <input
            id={dateId}
            type="date"
            value={date}
            onChange={(event) => {
              dirtyRef.current = true;
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
              앞으로의 날짜도 고를 수 있어요. 비워 두면 날짜 없이 저장해요.
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* 상태는 그대로 두고 날짜만 고칠 때. 'wish'에는 계획일이 없으므로 보여 주지 않는다. */}
          {status !== 'wish' ? (
            <button
              type="button"
              className="btn-primary"
              // 서버가 가진 값과 같으면 보낼 것이 없다(저장 직후 prop이 늦게 와도 판단이 흔들리지 않게
              // prop이 아니라 우리가 아는 서버 값을 기준으로 한다).
              disabled={pending || date.trim() === (serverDate ?? '')}
              aria-busy={pending}
              onClick={() => void submit(status)}
            >
              {pending ? '저장 중…' : '날짜만 저장'}
            </button>
          ) : null}
          {WISH_STATUSES.filter((value) => value !== status).map((value) => (
            <button
              key={value}
              type="button"
              className="btn-secondary"
              disabled={pending}
              aria-busy={pending}
              onClick={() => void submit(value)}
            >
              {`${STATUS_LABELS[value]}로 바꾸기`}
            </button>
          ))}
        </div>
        <p className="field-hint">‘하고 싶어요’로 되돌리면 계획한 날짜가 지워져요.</p>
      </fieldset>

      {/*
        CAL-001 전까지는 캘린더 일정이 없다. 저장 동작처럼 보이는 버튼을 두지 않고 안내만 한다.
        여기서 저장되는 것은 위시의 계획한 날짜뿐이다.
      */}
      <p className="mt-5 rounded-xl bg-surface-muted px-4 py-3 text-xs leading-relaxed text-muted">
        캘린더 일정 만들기는 아직 없어요. 지금은 이 위시에 계획한 날짜만 저장돼요. 두 사람의 캘린더 연결은 다음 작업
        (CAL-001)에서 만들어요.
      </p>
    </section>
  );
}
