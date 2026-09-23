'use client';

import { useEffect, useState } from 'react';

import { RESTAURANT_LIMITS } from '../constants';

import type { RestaurantFilters } from '../filters';

type SearchValues = { q: string; area: string; category: string };

function fromFilters(filters: RestaurantFilters): SearchValues {
  return { q: filters.q, area: filters.area, category: filters.category };
}

/**
 * 맛집 이름·지역·종류 검색 폼.
 *
 * - 일반 GET 폼이다(자바스크립트 없이도 동작, 필터는 URL 검색 매개변수, DESIGN 3).
 * - 입력칸은 **현재 URL의 필터**와 항상 같아야 한다. E2E v3에서 뒤로 가기 후 목록·URL은 이전 필터로 돌아왔는데
 *   이름 칸에는 직전에 입력한 검색어가 남아 있었다. 원인: 비제어 입력(`defaultValue`)에 브라우저의 폼 상태 복원이
 *   직전 입력값을 다시 채웠다(`autoComplete="off"`였던 지역·종류 칸은 복원되지 않아 비어 있었다).
 * - 그래서
 *   1) 모든 칸에 `autoComplete="off"`를 두어 폼 상태 복원을 끄고,
 *   2) 값은 URL 필터에서 온 제어 상태로 두고, 하이드레이션 직후와 bfcache 복원(`pageshow` persisted) 때
 *      URL 필터로 다시 맞춘다(복원된 값이 하이드레이션 중에 상태로 들어와도 되돌린다).
 *   3) 필터가 바뀌면 부모가 key를 바꿔 새로 시작한다.
 */
export function RestaurantSearchForm({
  filters,
  areaOptions,
  categoryOptions,
}: {
  filters: RestaurantFilters;
  areaOptions: string[];
  categoryOptions: string[];
}) {
  const [values, setValues] = useState<SearchValues>(() => fromFilters(filters));
  const { q, area, category } = filters;

  useEffect(() => {
    const sync = () => setValues({ q, area, category });
    // 하이드레이션 직후: 브라우저가 복원한 이전 입력을 URL 값으로 되돌린다.
    sync();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) sync();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [q, area, category]);

  function update(field: keyof SearchValues, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
  }

  return (
    <form
      action="/restaurants"
      method="get"
      role="search"
      autoComplete="off"
      className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
    >
      {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
      <div>
        <label htmlFor="restaurant-q" className="field-label">
          이름
        </label>
        <input
          id="restaurant-q"
          name="q"
          type="search"
          value={values.q}
          onChange={(event) => update('q', event.target.value)}
          maxLength={RESTAURANT_LIMITS.searchMax}
          placeholder="이름 일부"
          autoComplete="off"
          className="field-input"
        />
      </div>
      <div>
        <label htmlFor="restaurant-area" className="field-label">
          지역
        </label>
        <input
          id="restaurant-area"
          name="area"
          value={values.area}
          onChange={(event) => update('area', event.target.value)}
          list={areaOptions.length > 0 ? 'restaurant-area-options' : undefined}
          maxLength={RESTAURANT_LIMITS.areaMax}
          autoComplete="off"
          className="field-input"
        />
        {areaOptions.length > 0 ? (
          <datalist id="restaurant-area-options">
            {areaOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        ) : null}
      </div>
      <div>
        <label htmlFor="restaurant-category" className="field-label">
          음식 종류
        </label>
        <input
          id="restaurant-category"
          name="category"
          value={values.category}
          onChange={(event) => update('category', event.target.value)}
          list={categoryOptions.length > 0 ? 'restaurant-category-options' : undefined}
          maxLength={RESTAURANT_LIMITS.categoryMax}
          autoComplete="off"
          className="field-input"
        />
        {categoryOptions.length > 0 ? (
          <datalist id="restaurant-category-options">
            {categoryOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        ) : null}
      </div>
      <button type="submit" className="btn-primary">
        찾기
      </button>
    </form>
  );
}
