'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';

import { validateWith } from '@/features/auth/schemas';

import { saveCalendarEventAction } from '../actions';
import {
  CALENDAR_LIMITS,
  EVENT_KINDS,
  KIND_HINTS,
  KIND_LABELS,
  type EventKind,
} from '../constants';
import { codePointLength, eventInfoSchema } from '../schema';

import { focusFirstField, FormNotice, type Notice } from './FormNotice';
import { useCalendarMutation } from './use-calendar-mutation';
import { useHydrated } from './use-hydrated';

import type { WishOption } from '../types';

export type CalendarFormValues = {
  kind: EventKind;
  title: string;
  location: string;
  note: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  /** 빈 문자열은 "연결 없음". */
  wishItemId: string;
};

type Field = keyof CalendarFormValues;

/**
 * 일정 등록·수정 폼. 상태(완료 체크)는 상세 화면에서 따로 바꾼다.
 *
 * 시각 처리
 *   - 날짜와 시:분을 따로 보낸다. 서버(DB)가 **한국 시간**으로 조립하므로 브라우저 시간대가 달라도
 *     같은 날짜로 저장된다.
 *   - 종일을 켜면 시각 입력을 보내지 않는다(DB도 거부한다).
 *
 * 충돌 처리(PROJECT_PLAN 6, DESIGN 8.4)
 *   - 수정 기준 버전(`baseVersion`)은 이 폼의 상태로 들고 있다. 화면이 새로 그려져도
 *     **사용자가 "최신 내용 불러오기"를 누르기 전에는 바꾸지 않는다.** 조용한 덮어쓰기를 막기 위해서다.
 *   - 충돌이 나면 입력한 내용은 그대로 두고 안내만 한다.
 */
export function CalendarEventForm({
  mode,
  eventId = null,
  initialValues,
  version = 0,
  wishOptions,
  wishOptionsMessage = null,
  kindLocked = false,
  calendarHref,
}: {
  mode: 'create' | 'edit';
  eventId?: string | null;
  initialValues: CalendarFormValues;
  /** 서버에서 읽은 현재 버전. 새로 만들 때는 0. */
  version?: number;
  wishOptions: WishOption[];
  /** 위시 목록을 못 읽었을 때의 안내. 연결 없이 저장하는 것은 막지 않는다. */
  wishOptionsMessage?: string | null;
  /** 수정 화면에서는 종류를 바꿀 수 없다(DB도 거부한다). */
  kindLocked?: boolean;
  /**
   * 보고 있던 달·보기·필터가 담긴 `/calendar?...` 주소.
   * 저장 성공 후 상세로 갈 때와 취소할 때 함께 넘겨 그 상태를 잃지 않는다(독립 검토 P3-3).
   */
  calendarHref: string;
}) {
  const router = useRouter();
  const idPrefix = useId();
  const idFor = (field: string) => `${idPrefix}-${field}`;
  const noticeRef = useRef<HTMLDivElement>(null);
  const backQuery = `?back=${encodeURIComponent(calendarHref)}`;

  const [values, setValues] = useState<CalendarFormValues>(initialValues);
  const [baseVersion, setBaseVersion] = useState(version);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [conflict, setConflict] = useState(false);
  const [adoptLatest, setAdoptLatest] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [refreshing, startRefresh] = useTransition();

  // 성공하면 상세 화면으로 이동한다. 이동이 끝날 때까지 이 폼은 잠겨 두 번째 생성이 생기지 않는다.
  const { run, pending, locked } = useCalendarMutation(
    'saveCalendarEvent',
    saveCalendarEventAction,
    { lockOnSuccess: true },
  );
  const hydrated = useHydrated();

  // 사용자가 "최신 내용 불러오기"를 눌렀을 때만, 새로 고침이 끝난 뒤 서버의 새 값을 받아들인다.
  useEffect(() => {
    if (!adoptLatest || refreshing) return;
    setAdoptLatest(false);
    if (version === baseVersion) {
      setNotice({
        tone: 'error',
        message:
          '새로 불러온 내용의 버전이 그대로예요. 잠시 후 다시 불러오거나 상세 화면에서 확인해 주세요.',
      });
      return;
    }
    setValues(initialValues);
    setBaseVersion(version);
    setConflict(false);
    setFieldErrors({});
    setNotice({ tone: 'success', message: '최신 내용을 불러왔어요. 다시 고친 뒤 저장해 주세요.' });
  }, [adoptLatest, refreshing, version, baseVersion, initialValues]);

  useEffect(() => {
    if (focusTick === 0) return;
    focusFirstField(fieldErrors, idFor, noticeRef.current);
    // idFor는 렌더마다 새로 만들어지지만 결과는 같다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  function update<K extends Field>(field: K, value: CalendarFormValues[K]) {
    setValues((previous) => ({ ...previous, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((previous) => {
        const next = { ...previous };
        delete next[field];
        return next;
      });
    }
  }

  /** 종일을 켜면 시각 입력을 비운다. 끄면 시작 시각 기본값을 넣어 준다. */
  function toggleAllDay(next: boolean) {
    setValues((previous) => ({
      ...previous,
      allDay: next,
      startTime: next ? '' : previous.startTime === '' ? '19:00' : previous.startTime,
      endTime: next ? '' : previous.endTime,
    }));
    setFieldErrors({});
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 화면 상태는 한 박자 늦을 수 있다. 최종 판단은 훅의 동기 관문(run이 null 반환)이 한다.
    if (pending || locked) return;

    const candidate = {
      kind: values.kind,
      title: values.title,
      location: values.location,
      note: values.note,
      allDay: values.allDay,
      startDate: values.startDate,
      startTime: values.allDay ? '' : values.startTime,
      endDate: values.endDate,
      endTime: values.allDay ? '' : values.endTime,
      wishItemId: values.wishItemId === '' ? null : values.wishItemId,
    };

    const checked = validateWith(eventInfoSchema, candidate);
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      setNotice({
        tone: 'error',
        title: '입력을 확인해 주세요',
        message: Object.values(checked.fieldErrors)[0] ?? '',
      });
      setFocusTick((tick) => tick + 1);
      return;
    }

    // 검증을 통과한 값(다듬은 제목·장소·메모)을 보낸다. 서버도 같은 스키마로 다시 검증하므로
    // 결과는 같고, 재시도할 때 요청 키 서명이 흔들리지 않는다.
    const result = await run({
      eventId: mode === 'edit' ? eventId : null,
      kind: checked.data.kind,
      title: checked.data.title,
      location: checked.data.location ?? '',
      note: checked.data.note,
      allDay: checked.data.allDay,
      startDate: checked.data.startDate,
      startTime: checked.data.startTime ?? '',
      endDate: checked.data.endDate ?? '',
      endTime: checked.data.endTime ?? '',
      wishItemId: checked.data.wishItemId,
      expectedVersion: mode === 'edit' ? baseVersion : 0,
    });
    if (result === null) return;

    if (result.ok) {
      setNotice({ tone: 'success', message: '저장했어요.' });
      // 상세로 갈 때도 보고 있던 달·필터를 함께 넘긴다.
      router.push(`/calendar/${result.data.eventId}${backQuery}`);
      return;
    }

    setFieldErrors(result.fieldErrors ?? {});
    setConflict(result.code === 'CONFLICT');
    setNotice({ tone: 'error', message: result.message });
    setFocusTick((tick) => tick + 1);
  }

  const noteLength = codePointLength(values.note);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-busy={pending}>
      <FormNotice ref={noticeRef} notice={notice}>
        {conflict && mode === 'edit' ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary !min-h-[36px] !px-3 text-xs"
              disabled={refreshing}
              onClick={() => {
                setAdoptLatest(true);
                startRefresh(() => router.refresh());
              }}
            >
              {refreshing ? '불러오는 중…' : '최신 내용 불러오기 (입력한 내용은 사라져요)'}
            </button>
            {eventId ? (
              <Link
                href={`/calendar/${eventId}${backQuery}`}
                target="_blank"
                className="btn-quiet !min-h-[36px] !px-3 text-xs"
              >
                새 탭에서 최신 내용 보기
              </Link>
            ) : null}
          </div>
        ) : null}
      </FormNotice>

      {/*
        하이드레이션 전에는 입력·제출을 막는다. 막지 않으면 제출 버튼이 브라우저 기본 GET 제출을 일으켜
        제목·메모가 주소 쿼리로 나가고, 입력한 값도 하이드레이션 중에 사라질 수 있다.
      */}
      <fieldset
        disabled={!hydrated || locked}
        aria-busy={!hydrated || locked || undefined}
        className="min-w-0 space-y-5 border-0 p-0"
      >
        <legend className="sr-only">일정 정보</legend>

        <div>
          <label htmlFor={idFor('kind')} className="field-label">
            일정 종류
          </label>
          <select
            id={idFor('kind')}
            name="kind"
            value={values.kind}
            disabled={kindLocked}
            onChange={(event) => update('kind', event.target.value as EventKind)}
            className="field-input"
            aria-invalid={fieldErrors.kind ? true : undefined}
            aria-describedby={`${idFor('kind')}-hint${fieldErrors.kind ? ` ${idFor('kind')}-error` : ''}`}
          >
            {EVENT_KINDS.map((value) => (
              <option key={value} value={value}>
                {KIND_LABELS[value]}
              </option>
            ))}
          </select>
          <p id={`${idFor('kind')}-hint`} className="field-hint">
            {kindLocked
              ? '종류는 만든 뒤에 바꿀 수 없어요. 바꾸려면 새 일정으로 만들어 주세요.'
              : KIND_HINTS[values.kind]}
          </p>
          {fieldErrors.kind ? (
            <p id={`${idFor('kind')}-error`} className="field-error">
              {fieldErrors.kind}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={idFor('title')} className="field-label">
            제목
            <span className="ml-1 text-xs font-normal text-muted">(필수)</span>
          </label>
          <input
            id={idFor('title')}
            name="title"
            type="text"
            value={values.title}
            onChange={(event) => update('title', event.target.value)}
            required
            autoComplete="off"
            className="field-input"
            aria-invalid={fieldErrors.title ? true : undefined}
            aria-describedby={`${idFor('title')}-hint${fieldErrors.title ? ` ${idFor('title')}-error` : ''}`}
          />
          <p id={`${idFor('title')}-hint`} className="field-hint">
            {CALENDAR_LIMITS.titleMax}자까지
          </p>
          {fieldErrors.title ? (
            <p id={`${idFor('title')}-error`} className="field-error">
              {fieldErrors.title}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <input
            id={idFor('allDay')}
            name="allDay"
            type="checkbox"
            checked={values.allDay}
            onChange={(event) => toggleAllDay(event.target.checked)}
            className="h-5 w-5 rounded border-border accent-[color:var(--color-accent)]"
          />
          <label htmlFor={idFor('allDay')} className="text-sm font-medium text-text">
            종일 일정
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={idFor('startDate')} className="field-label">
              시작 날짜
              <span className="ml-1 text-xs font-normal text-muted">(필수)</span>
            </label>
            <input
              id={idFor('startDate')}
              name="startDate"
              type="date"
              value={values.startDate}
              onChange={(event) => update('startDate', event.target.value)}
              required
              className="field-input"
              aria-invalid={fieldErrors.startDate ? true : undefined}
              aria-describedby={fieldErrors.startDate ? `${idFor('startDate')}-error` : undefined}
            />
            {fieldErrors.startDate ? (
              <p id={`${idFor('startDate')}-error`} className="field-error">
                {fieldErrors.startDate}
              </p>
            ) : null}
          </div>

          {values.allDay ? null : (
            <div>
              <label htmlFor={idFor('startTime')} className="field-label">
                시작 시각
                <span className="ml-1 text-xs font-normal text-muted">(필수)</span>
              </label>
              <input
                id={idFor('startTime')}
                name="startTime"
                type="time"
                value={values.startTime}
                onChange={(event) => update('startTime', event.target.value)}
                className="field-input"
                aria-invalid={fieldErrors.startTime ? true : undefined}
                aria-describedby={fieldErrors.startTime ? `${idFor('startTime')}-error` : undefined}
              />
              {fieldErrors.startTime ? (
                <p id={`${idFor('startTime')}-error`} className="field-error">
                  {fieldErrors.startTime}
                </p>
              ) : null}
            </div>
          )}

          <div>
            <label htmlFor={idFor('endDate')} className="field-label">
              끝나는 날짜 <span className="ml-1 text-xs font-normal text-muted">(선택)</span>
            </label>
            <input
              id={idFor('endDate')}
              name="endDate"
              type="date"
              value={values.endDate}
              onChange={(event) => update('endDate', event.target.value)}
              className="field-input"
              aria-invalid={fieldErrors.endDate ? true : undefined}
              aria-describedby={`${idFor('endDate')}-hint${fieldErrors.endDate ? ` ${idFor('endDate')}-error` : ''}`}
            />
            <p id={`${idFor('endDate')}-hint`} className="field-hint">
              {values.allDay
                ? '비워 두면 하루 일정이에요. 여행처럼 며칠이면 마지막 날을 골라요.'
                : '같은 날에 끝나면 비워 둬요.'}
            </p>
            {fieldErrors.endDate ? (
              <p id={`${idFor('endDate')}-error`} className="field-error">
                {fieldErrors.endDate}
              </p>
            ) : null}
          </div>

          {values.allDay ? null : (
            <div>
              <label htmlFor={idFor('endTime')} className="field-label">
                끝나는 시각 <span className="ml-1 text-xs font-normal text-muted">(선택)</span>
              </label>
              <input
                id={idFor('endTime')}
                name="endTime"
                type="time"
                value={values.endTime}
                onChange={(event) => update('endTime', event.target.value)}
                className="field-input"
                aria-invalid={fieldErrors.endTime ? true : undefined}
                aria-describedby={`${idFor('endTime')}-hint${fieldErrors.endTime ? ` ${idFor('endTime')}-error` : ''}`}
              />
              <p id={`${idFor('endTime')}-hint`} className="field-hint">
                비워 두면 끝나는 시각 없이 저장해요.
              </p>
              {fieldErrors.endTime ? (
                <p id={`${idFor('endTime')}-error`} className="field-error">
                  {fieldErrors.endTime}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div>
          <label htmlFor={idFor('location')} className="field-label">
            장소 <span className="ml-1 text-xs font-normal text-muted">(선택)</span>
          </label>
          <input
            id={idFor('location')}
            name="location"
            type="text"
            value={values.location}
            onChange={(event) => update('location', event.target.value)}
            autoComplete="off"
            className="field-input"
            aria-invalid={fieldErrors.location ? true : undefined}
            aria-describedby={`${idFor('location')}-hint${fieldErrors.location ? ` ${idFor('location')}-error` : ''}`}
          />
          <p id={`${idFor('location')}-hint`} className="field-hint">
            {CALENDAR_LIMITS.locationMax}자까지
          </p>
          {fieldErrors.location ? (
            <p id={`${idFor('location')}-error`} className="field-error">
              {fieldErrors.location}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={idFor('wishItemId')} className="field-label">
            위시 연결 <span className="ml-1 text-xs font-normal text-muted">(선택)</span>
          </label>
          <select
            id={idFor('wishItemId')}
            name="wishItemId"
            value={values.wishItemId}
            onChange={(event) => update('wishItemId', event.target.value)}
            className="field-input"
            aria-invalid={fieldErrors.wishItemId ? true : undefined}
            aria-describedby={`${idFor('wishItemId')}-hint${fieldErrors.wishItemId ? ` ${idFor('wishItemId')}-error` : ''}`}
          >
            <option value="">연결 없음</option>
            {wishOptions.map((wish) => (
              <option key={wish.id} value={wish.id}>
                {wish.title}
              </option>
            ))}
          </select>
          <p id={`${idFor('wishItemId')}-hint`} className="field-hint">
            {wishOptionsMessage ??
              '같은 공간의 위시만 연결할 수 있어요. 연결한 위시는 일정을 먼저 지워야 삭제할 수 있어요.'}
          </p>
          {fieldErrors.wishItemId ? (
            <p id={`${idFor('wishItemId')}-error`} className="field-error">
              {fieldErrors.wishItemId}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={idFor('note')} className="field-label">
            메모 <span className="ml-1 text-xs font-normal text-muted">(선택)</span>
          </label>
          <textarea
            id={idFor('note')}
            name="note"
            rows={4}
            value={values.note}
            onChange={(event) => update('note', event.target.value)}
            className="field-input"
            aria-invalid={fieldErrors.note ? true : undefined}
            aria-describedby={`${idFor('note')}-hint${fieldErrors.note ? ` ${idFor('note')}-error` : ''}`}
          />
          <p id={`${idFor('note')}-hint`} className="field-hint">
            {noteLength.toLocaleString('ko-KR')} / {CALENDAR_LIMITS.noteMax.toLocaleString('ko-KR')}
            자
          </p>
          {fieldErrors.note ? (
            <p id={`${idFor('note')}-error`} className="field-error">
              {fieldErrors.note}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="btn-primary"
            disabled={pending || locked}
            aria-busy={pending || locked}
          >
            {pending
              ? '저장 중…'
              : locked
                ? '저장했어요. 이동 중…'
                : mode === 'create'
                  ? '일정 등록'
                  : '변경 저장'}
          </button>
          <Link
            href={mode === 'edit' && eventId ? `/calendar/${eventId}${backQuery}` : calendarHref}
            className="btn-quiet"
          >
            취소
          </Link>
        </div>
      </fieldset>
    </form>
  );
}
