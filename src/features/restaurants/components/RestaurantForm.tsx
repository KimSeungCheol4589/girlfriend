'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';

import { validateWith } from '@/features/auth/schemas';

import { saveRestaurantAction } from '../actions';
import { RESTAURANT_LIMITS } from '../constants';
import { codePointLength, restaurantInfoSchema } from '../schema';

import { focusFirstField, FormNotice, type Notice } from './FormNotice';
import { useHydrated } from './use-hydrated';
import { useRestaurantMutation } from './use-restaurant-mutation';

export type RestaurantFormValues = {
  name: string;
  area: string;
  category: string;
  mapUrl: string;
  memo: string;
};

type Field = keyof RestaurantFormValues;

const EMPTY: RestaurantFormValues = { name: '', area: '', category: '', mapUrl: '', memo: '' };

/**
 * 맛집 등록·정보 수정 폼. 방문 상태는 상세 화면에서 따로 바꾼다(CONTRACTS.md 4).
 *
 * 충돌 처리(PROJECT_PLAN 6, DESIGN 8.4)
 *   - 수정 기준 버전(`baseVersion`)은 이 폼의 상태로 들고 있다. 화면이 새로 그려져도
 *     **사용자가 "최신 내용 불러오기"를 누르기 전에는 바꾸지 않는다.** 조용한 덮어쓰기를 막기 위해서다.
 *   - 충돌이 나면 입력한 내용은 그대로 두고 안내만 한다.
 */
export function RestaurantForm({
  mode,
  restaurantId = null,
  initialValues = EMPTY,
  version = 0,
  areaOptions = [],
  categoryOptions = [],
}: {
  mode: 'create' | 'edit';
  restaurantId?: string | null;
  initialValues?: RestaurantFormValues;
  /** 서버에서 읽은 현재 버전. 새로 만들 때는 0. */
  version?: number;
  areaOptions?: string[];
  categoryOptions?: string[];
}) {
  const router = useRouter();
  const idPrefix = useId();
  const idFor = (field: string) => `${idPrefix}-${field}`;
  const noticeRef = useRef<HTMLDivElement>(null);

  const [values, setValues] = useState<RestaurantFormValues>(initialValues);
  const [baseVersion, setBaseVersion] = useState(version);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [conflict, setConflict] = useState(false);
  const [adoptLatest, setAdoptLatest] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [refreshing, startRefresh] = useTransition();

  // 성공하면 상세 화면으로 이동한다. 이동이 끝날 때까지 이 폼은 잠겨 두 번째 생성이 생기지 않는다.
  const { run, pending, locked } = useRestaurantMutation('saveRestaurant', saveRestaurantAction, {
    lockOnSuccess: true,
  });
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

    const checked = validateWith(restaurantInfoSchema, values);
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      setNotice({ tone: 'error', title: '입력을 확인해 주세요', message: Object.values(checked.fieldErrors)[0] ?? '' });
      setFocusTick((tick) => tick + 1);
      return;
    }

    const result = await run({
      restaurantId: mode === 'edit' ? restaurantId : null,
      name: values.name,
      area: values.area,
      category: values.category,
      mapUrl: values.mapUrl,
      memo: values.memo,
      expectedVersion: mode === 'edit' ? baseVersion : 0,
    });
    if (result === null) return;

    if (result.ok) {
      setNotice({ tone: 'success', message: '저장했어요.' });
      router.push(`/restaurants/${result.data.restaurantId}`);
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
            {restaurantId ? (
              <Link href={`/restaurants/${restaurantId}`} target="_blank" className="btn-quiet !min-h-[36px] !px-3 text-xs">
                새 탭에서 최신 내용 보기
              </Link>
            ) : null}
          </div>
        ) : null}
      </FormNotice>

      {/*
        하이드레이션 전에는 입력·제출을 막는다. 막지 않으면 제출 버튼이 브라우저 기본 GET 제출을 일으켜
        이름·메모가 주소 쿼리로 나가고, 입력한 값도 하이드레이션 중에 사라질 수 있다(1차 E2E 분석).
      */}
      <fieldset
        disabled={!hydrated || locked}
        aria-busy={!hydrated || locked || undefined}
        className="min-w-0 space-y-5 border-0 p-0"
      >
      <legend className="sr-only">맛집 정보</legend>
      <TextField
        id={idFor('name')}
        name="name"
        label="이름"
        required
        value={values.name}
        onChange={(value) => update('name', value)}
        error={fieldErrors.name}
        hint={`${RESTAURANT_LIMITS.nameMax}자까지`}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          id={idFor('area')}
          name="area"
          label="지역"
          value={values.area}
          onChange={(value) => update('area', value)}
          error={fieldErrors.area}
          listId={areaOptions.length > 0 ? `${idPrefix}-areas` : undefined}
          hint="예: 성수, 연남"
        />
        <TextField
          id={idFor('category')}
          name="category"
          label="음식 종류"
          value={values.category}
          onChange={(value) => update('category', value)}
          error={fieldErrors.category}
          listId={categoryOptions.length > 0 ? `${idPrefix}-categories` : undefined}
          hint="예: 한식, 파스타"
        />
      </div>
      {areaOptions.length > 0 ? (
        <datalist id={`${idPrefix}-areas`}>
          {areaOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
      {categoryOptions.length > 0 ? (
        <datalist id={`${idPrefix}-categories`}>
          {categoryOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}

      <TextField
        id={idFor('mapUrl')}
        name="mapUrl"
        label="지도 링크"
        type="url"
        inputMode="url"
        value={values.mapUrl}
        onChange={(value) => update('mapUrl', value)}
        error={fieldErrors.mapUrl}
        hint="네이버 지도·카카오맵의 https 공유 링크만 저장해요. 링크 내용을 가져오지 않아요."
      />

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
          {memoLength.toLocaleString('ko-KR')} / {RESTAURANT_LIMITS.memoMax.toLocaleString('ko-KR')}자
        </p>
        {fieldErrors.memo ? (
          <p id={`${idFor('memo')}-error`} className="field-error">
            {fieldErrors.memo}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn-primary" disabled={pending || locked} aria-busy={pending || locked}>
          {pending ? '저장 중…' : locked ? '저장했어요. 이동 중…' : mode === 'create' ? '맛집 등록' : '변경 저장'}
        </button>
        <Link
          href={mode === 'edit' && restaurantId ? `/restaurants/${restaurantId}` : '/restaurants'}
          className="btn-quiet"
        >
          취소
        </Link>
      </div>
      </fieldset>
    </form>
  );
}

function TextField({
  id,
  name,
  label,
  value,
  onChange,
  error,
  hint,
  required,
  type = 'text',
  inputMode,
  listId,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  type?: 'text' | 'url';
  inputMode?: 'text' | 'url';
  listId?: string;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {required ? <span className="ml-1 text-xs font-normal text-muted">(필수)</span> : null}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        list={listId}
        autoComplete="off"
        className="field-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
