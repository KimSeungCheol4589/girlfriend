'use client';

import { useEffect, useState } from 'react';

import { CATEGORY_LABELS, WISH_CATEGORIES, WISH_LIMITS } from '../constants';

import { useHydrated } from './use-hydrated';

import type { WishFilters } from '../filters';

/**
 * 위시 제목·분류 검색 폼.
 *
 * - 일반 GET 폼이다(자바스크립트 없이도 동작, 필터는 URL 검색 매개변수, DESIGN 3).
 * - 입력칸은 **현재 URL의 필터**와 항상 같아야 한다. 비제어 입력에 브라우저 폼 상태 복원이 끼어들면
 *   뒤로 가기 뒤 목록·URL과 입력칸이 어긋난다. 그래서
 *   1) 모든 칸에 `autoComplete="off"`를 두어 폼 상태 복원을 끄고,
 *   2) 값은 URL 필터에서 온 제어 상태로 두고, 하이드레이션 직후와 bfcache 복원(`pageshow` persisted) 때
 *      URL 필터로 다시 맞춘다,
 *   3) 필터가 바뀌면 부모가 key를 바꿔 새로 시작한다.
 */
export function WishSearchForm({ filters }: { filters: WishFilters }) {
  const [values, setValues] = useState(() => ({ q: filters.q, category: filters.category ?? '' }));
  const { q, category } = filters;
  // 하이드레이션 전에는 아직 이 폼이 입력을 기억하지 못한다(아래 sync가 URL 값으로 되돌린다).
  // 입력칸을 막으면 자바스크립트 없이 쓰는 경로가 깨지므로 막지 않고 상태만 알린다.
  const hydrated = useHydrated();

  useEffect(() => {
    const sync = () => setValues({ q, category: category ?? '' });
    // 하이드레이션 직후: 브라우저가 복원한 이전 입력을 URL 값으로 되돌린다.
    sync();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) sync();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [q, category]);

  return (
    <form
      action="/wishes"
      method="get"
      role="search"
      autoComplete="off"
      data-hydrated={hydrated ? 'true' : 'false'}
      className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
    >
      {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
      <div>
        <label htmlFor="wish-q" className="field-label">
          제목
        </label>
        <input
          id="wish-q"
          name="q"
          type="search"
          value={values.q}
          onChange={(event) => setValues((previous) => ({ ...previous, q: event.target.value }))}
          maxLength={WISH_LIMITS.searchMax}
          placeholder="제목 일부"
          autoComplete="off"
          className="field-input"
        />
      </div>
      <div>
        <label htmlFor="wish-category" className="field-label">
          분류
        </label>
        <select
          id="wish-category"
          name="category"
          value={values.category}
          onChange={(event) => setValues((previous) => ({ ...previous, category: event.target.value }))}
          autoComplete="off"
          className="field-input"
        >
          <option value="">전체</option>
          {WISH_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn-primary">
        찾기
      </button>
    </form>
  );
}
