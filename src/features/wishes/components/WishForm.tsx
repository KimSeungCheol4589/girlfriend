'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';

import { validateWith } from '@/features/auth/schemas';

import { saveWishAction } from '../actions';
import { CATEGORY_LABELS, DEFAULT_CATEGORY, WISH_CATEGORIES, WISH_LIMITS } from '../constants';
import { codePointLength, wishInfoSchema } from '../schema';

import { focusFirstField, FormNotice, type Notice } from './FormNotice';
import { useHydrated } from './use-hydrated';
import { useWishMutation } from './use-wish-mutation';

export type WishFormValues = {
  title: string;
  category: string;
  memo: string;
  linkUrl: string;
};

type Field = keyof WishFormValues;

const EMPTY: WishFormValues = { title: '', category: DEFAULT_CATEGORY, memo: '', linkUrl: '' };

/**
 * 위시 등록·정보 수정 폼. 상태와 계획일은 상세 화면에서 따로 바꾼다.
 *
 * 충돌 처리(PROJECT_PLAN 6, DESIGN 8.4)
 *   - 수정 기준 버전(`baseVersion`)은 이 폼의 상태로 들고 있다. 화면이 새로 그려져도
 *     **사용자가 "최신 내용 불러오기"를 누르기 전에는 바꾸지 않는다.** 조용한 덮어쓰기를 막기 위해서다.
 *   - 충돌이 나면 입력한 내용은 그대로 두고 안내만 한다.
 */
export function WishForm({
  mode,
  wishId = null,
  initialValues = EMPTY,
  version = 0,
}: {
  mode: 'create' | 'edit';
  wishId?: string | null;
  initialValues?: WishFormValues;
  /** 서버에서 읽은 현재 버전. 새로 만들 때는 0. */
  version?: number;
}) {
  const router = useRouter();
  const idPrefix = useId();
  const idFor = (field: string) => `${idPrefix}-${field}`;
  const noticeRef = useRef<HTMLDivElement>(null);

  const [values, setValues] = useState<WishFormValues>(initialValues);
  const [baseVersion, setBaseVersion] = useState(version);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [conflict, setConflict] = useState(false);
  const [adoptLatest, setAdoptLatest] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [refreshing, startRefresh] = useTransition();

  // 성공하면 상세 화면으로 이동한다. 이동이 끝날 때까지 이 폼은 잠겨 두 번째 생성이 생기지 않는다.
  const { run, pending, locked } = useWishMutation('saveWish', saveWishAction, { lockOnSuccess: true });
  const hydrated = useHydrated();

  // 사용자가 "최신 내용 불러오기"를 눌렀을 때만, 새로 고침이 끝난 뒤 서버의 새 값을 받아들인다.
  useEffect(() => {
    if (!adoptLatest || refreshing) return;
    setAdoptLatest(false);
    if (version === baseVersion) {
      setNotice({
        tone: 'error',
        message: '새로 불러온 내용의 버전이 그대로예요. 잠시 후 다시 불러오거나 상세 화면에서 확인해 주세요.',
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

  function update(field: Field, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((previous) => {
        const next = { ...previous };
        delete next[field];
        return next;
      });
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 화면 상태는 한 박자 늦을 수 있다. 최종 판단은 훅의 동기 관문(run이 null 반환)이 한다.
    if (pending || locked) return;

    const checked = validateWith(wishInfoSchema, values);
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      setNotice({ tone: 'error', title: '입력을 확인해 주세요', message: Object.values(checked.fieldErrors)[0] ?? '' });
      setFocusTick((tick) => tick + 1);
      return;
    }

    // 검증을 통과한 값(다듬은 제목·메모, 정규화한 분류·링크)을 보낸다.
    // 서버도 같은 스키마로 다시 검증하므로 결과는 같고, 재시도할 때 요청 키 서명이 흔들리지 않는다.
    const result = await run({
      wishId: mode === 'edit' ? wishId : null,
      title: checked.data.title,
      category: checked.data.category,
      memo: checked.data.memo,
      linkUrl: checked.data.linkUrl ?? '',
      expectedVersion: mode === 'edit' ? baseVersion : 0,
    });
    if (result === null) return;

    if (result.ok) {
      setNotice({ tone: 'success', message: '저장했어요.' });
      router.push(`/wishes/${result.data.wishId}`);
      return;
    }

    setFieldErrors(result.fieldErrors ?? {});
    setConflict(result.code === 'CONFLICT');
    setNotice({ tone: 'error', message: result.message });
    setFocusTick((tick) => tick + 1);
  }

  const memoLength = codePointLength(values.memo);

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
            {wishId ? (
              <Link href={`/wishes/${wishId}`} target="_blank" className="btn-quiet !min-h-[36px] !px-3 text-xs">
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
        <legend className="sr-only">위시 정보</legend>

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
            {WISH_LIMITS.titleMax}자까지
          </p>
          {fieldErrors.title ? (
            <p id={`${idFor('title')}-error`} className="field-error">
              {fieldErrors.title}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={idFor('category')} className="field-label">
            분류
          </label>
          <select
            id={idFor('category')}
            name="category"
            value={values.category}
            onChange={(event) => update('category', event.target.value)}
            className="field-input"
            aria-invalid={fieldErrors.category ? true : undefined}
            aria-describedby={fieldErrors.category ? `${idFor('category')}-error` : undefined}
          >
            {WISH_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
          {fieldErrors.category ? (
            <p id={`${idFor('category')}-error`} className="field-error">
              {fieldErrors.category}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={idFor('linkUrl')} className="field-label">
            링크
          </label>
          <input
            id={idFor('linkUrl')}
            name="linkUrl"
            type="url"
            inputMode="url"
            value={values.linkUrl}
            onChange={(event) => update('linkUrl', event.target.value)}
            autoComplete="off"
            className="field-input"
            aria-invalid={fieldErrors.linkUrl ? true : undefined}
            aria-describedby={`${idFor('linkUrl')}-hint${fieldErrors.linkUrl ? ` ${idFor('linkUrl')}-error` : ''}`}
          />
          <p id={`${idFor('linkUrl')}-hint`} className="field-hint">
            https 주소만 저장해요. 링크 내용을 가져오지 않아요.
          </p>
          {fieldErrors.linkUrl ? (
            <p id={`${idFor('linkUrl')}-error`} className="field-error">
              {fieldErrors.linkUrl}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={idFor('memo')} className="field-label">
            메모
          </label>
          <textarea
            id={idFor('memo')}
            name="memo"
            rows={4}
            value={values.memo}
            onChange={(event) => update('memo', event.target.value)}
            className="field-input"
            aria-invalid={fieldErrors.memo ? true : undefined}
            aria-describedby={`${idFor('memo')}-hint${fieldErrors.memo ? ` ${idFor('memo')}-error` : ''}`}
          />
          <p id={`${idFor('memo')}-hint`} className="field-hint">
            {memoLength.toLocaleString('ko-KR')} / {WISH_LIMITS.memoMax.toLocaleString('ko-KR')}자
          </p>
          {fieldErrors.memo ? (
            <p id={`${idFor('memo')}-error`} className="field-error">
              {fieldErrors.memo}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary" disabled={pending || locked} aria-busy={pending || locked}>
            {pending ? '저장 중…' : locked ? '저장했어요. 이동 중…' : mode === 'create' ? '위시 등록' : '변경 저장'}
          </button>
          <Link href={mode === 'edit' && wishId ? `/wishes/${wishId}` : '/wishes'} className="btn-quiet">
            취소
          </Link>
        </div>
      </fieldset>
    </form>
  );
}
