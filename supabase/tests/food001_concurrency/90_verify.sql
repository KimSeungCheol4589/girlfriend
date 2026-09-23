-- FOOD-001 동시성 판정 — 세션 결과 표(tests_food_race.results)와 최종 DB 상태를 함께 본다.
-- 하나라도 어긋나면 예외(TS001)로 실패한다.

\set ON_ERROR_STOP on

do $verify$
declare
  v_fail text[] := array[]::text[];
  r1 tests_food_race.results%rowtype;
  r2 tests_food_race.results%rowtype;
  v_rest public.restaurants%rowtype;
  v_count integer;
begin
  -- 결과 12행
  select count(*) into v_count from tests_food_race.results;
  if v_count <> 12 then
    v_fail := v_fail || format('결과 행 수 %s (기대 12)', v_count);
  end if;

  -- 1) review_vs_cancel: B 후기가 먼저 커밋 → A의 확인형 취소(버전 1)는 stale
  select * into r1 from tests_food_race.results where scenario = 'review_vs_cancel' and session_no = 1;
  select * into r2 from tests_food_race.results where scenario = 'review_vs_cancel' and session_no = 2;
  select * into v_rest from public.restaurants where id = '0f00d001-0000-4000-8000-0000000000c1';
  select count(*) into v_count from public.restaurant_reviews where restaurant_id = '0f00d001-0000-4000-8000-0000000000c1';
  if r1.sqlstate is not null then v_fail := v_fail || format('review_vs_cancel s1 실패 %s', r1.sqlstate); end if;
  if r2.sqlstate is distinct from 'GF409' or coalesce(r2.detail, '') not like '%expectedVersion%stale%' then
    v_fail := v_fail || format('review_vs_cancel s2 기대 GF409 stale, 실제 %s %s', r2.sqlstate, r2.detail);
  end if;
  if v_rest.status <> 'visited' or v_rest.version <> 2 or v_count <> 1 then
    v_fail := v_fail || format('review_vs_cancel 최종 상태 %s v%s 후기 %s (기대 visited v2 후기 1)', v_rest.status, v_rest.version, v_count);
  end if;

  -- 2) edit_vs_delete: B 후기 수정이 먼저 → A의 확인형 삭제(버전 1)는 stale, 수정된 후기 유지
  select * into r1 from tests_food_race.results where scenario = 'edit_vs_delete' and session_no = 1;
  select * into r2 from tests_food_race.results where scenario = 'edit_vs_delete' and session_no = 2;
  select * into v_rest from public.restaurants where id = '0f00d001-0000-4000-8000-0000000000c2';
  if r1.sqlstate is not null then v_fail := v_fail || format('edit_vs_delete s1 실패 %s', r1.sqlstate); end if;
  if r2.sqlstate is distinct from 'GF409' or coalesce(r2.detail, '') not like '%expectedVersion%stale%' then
    v_fail := v_fail || format('edit_vs_delete s2 기대 GF409 stale, 실제 %s %s', r2.sqlstate, r2.detail);
  end if;
  if v_rest.id is null or v_rest.version <> 2 then
    v_fail := v_fail || format('edit_vs_delete 맛집이 없거나 버전 %s (기대 2)', v_rest.version);
  end if;
  if not exists (select 1 from public.restaurant_reviews
                  where id = '0f00d001-0000-4000-8000-0000000000e2' and comment = 'B 수정한 후기' and version = 2) then
    v_fail := v_fail || 'edit_vs_delete 수정된 후기가 남아 있지 않다';
  end if;

  -- 3) two_reviews: 둘 다 성공(맛집 잠금으로 직렬화), 맛집 버전 3, 후기 2
  select * into r1 from tests_food_race.results where scenario = 'two_reviews' and session_no = 1;
  select * into r2 from tests_food_race.results where scenario = 'two_reviews' and session_no = 2;
  select * into v_rest from public.restaurants where id = '0f00d001-0000-4000-8000-0000000000c3';
  select count(*) into v_count from public.restaurant_reviews where restaurant_id = '0f00d001-0000-4000-8000-0000000000c3';
  if r1.sqlstate is not null or r2.sqlstate is not null then
    v_fail := v_fail || format('two_reviews 실패 s1=%s s2=%s', r1.sqlstate, r2.sqlstate);
  end if;
  if (r1.result ->> 'restaurantVersion') is distinct from '2' or (r2.result ->> 'restaurantVersion') is distinct from '3' then
    v_fail := v_fail || format('two_reviews 반환 버전 s1=%s s2=%s (기대 2, 3)',
                               r1.result ->> 'restaurantVersion', r2.result ->> 'restaurantVersion');
  end if;
  if v_rest.version <> 3 or v_count <> 2 then
    v_fail := v_fail || format('two_reviews 최종 v%s 후기 %s (기대 v3 후기 2)', v_rest.version, v_count);
  end if;

  -- 4) cancel_vs_review: 확인 없는 취소가 먼저(후기 없음) → B 후기는 not_visited, 후기 0
  select * into r1 from tests_food_race.results where scenario = 'cancel_vs_review' and session_no = 1;
  select * into r2 from tests_food_race.results where scenario = 'cancel_vs_review' and session_no = 2;
  select * into v_rest from public.restaurants where id = '0f00d001-0000-4000-8000-0000000000c4';
  select count(*) into v_count from public.restaurant_reviews where restaurant_id = '0f00d001-0000-4000-8000-0000000000c4';
  if r1.sqlstate is not null then v_fail := v_fail || format('cancel_vs_review s1 실패 %s', r1.sqlstate); end if;
  if r2.sqlstate is distinct from 'GF409' or coalesce(r2.detail, '') not like '%not_visited%' then
    v_fail := v_fail || format('cancel_vs_review s2 기대 GF409 not_visited, 실제 %s %s', r2.sqlstate, r2.detail);
  end if;
  if v_rest.status <> 'wishlist' or v_rest.visited_date is not null or v_rest.version <> 2 or v_count <> 0 then
    v_fail := v_fail || format('cancel_vs_review 최종 %s v%s 후기 %s (기대 wishlist v2 후기 0)', v_rest.status, v_rest.version, v_count);
  end if;

  -- 5) review_delete_vs_cancel: B 후기 삭제가 먼저 → A의 확인형 취소(버전 1)는 stale
  select * into r1 from tests_food_race.results where scenario = 'review_delete_vs_cancel' and session_no = 1;
  select * into r2 from tests_food_race.results where scenario = 'review_delete_vs_cancel' and session_no = 2;
  select * into v_rest from public.restaurants where id = '0f00d001-0000-4000-8000-0000000000c5';
  select count(*) into v_count from public.restaurant_reviews where restaurant_id = '0f00d001-0000-4000-8000-0000000000c5';
  if r1.sqlstate is not null or (r1.result ->> 'restaurantVersion') is distinct from '2' then
    v_fail := v_fail || format('review_delete_vs_cancel s1 %s 버전 %s', r1.sqlstate, r1.result ->> 'restaurantVersion');
  end if;
  if r2.sqlstate is distinct from 'GF409' or coalesce(r2.detail, '') not like '%expectedVersion%stale%' then
    v_fail := v_fail || format('review_delete_vs_cancel s2 기대 GF409 stale, 실제 %s %s', r2.sqlstate, r2.detail);
  end if;
  if v_rest.status <> 'visited' or v_rest.version <> 2 or v_count <> 0 then
    v_fail := v_fail || format('review_delete_vs_cancel 최종 %s v%s 후기 %s (기대 visited v2 후기 0)', v_rest.status, v_rest.version, v_count);
  end if;

  -- 6) retry: 같은 requestId·같은 입력 동시 재전송 → 둘 다 같은 결과, 버전은 한 번만 오른다
  select * into r1 from tests_food_race.results where scenario = 'retry' and session_no = 1;
  select * into r2 from tests_food_race.results where scenario = 'retry' and session_no = 2;
  select * into v_rest from public.restaurants where id = '0f00d001-0000-4000-8000-0000000000c6';
  select count(*) into v_count from public.restaurant_reviews where restaurant_id = '0f00d001-0000-4000-8000-0000000000c6';
  if r1.sqlstate is not null or r2.sqlstate is not null or r1.result is distinct from r2.result then
    v_fail := v_fail || format('retry 결과 불일치 s1=%s s2=%s', r1.sqlstate, r2.sqlstate);
  end if;
  if v_rest.version <> 2 or v_count <> 1 then
    v_fail := v_fail || format('retry 최종 v%s 후기 %s (기대 v2 후기 1)', v_rest.version, v_count);
  end if;
  select count(*) into v_count from public.mutation_requests
   where request_id = '0f00d001-0000-4000-8000-0000000006a0';
  if v_count <> 1 then
    v_fail := v_fail || format('retry 요청 기록 %s건 (기대 1)', v_count);
  end if;

  -- 공통 불변식: wishlist 맛집에는 후기가 없다
  select count(*) into v_count
    from public.restaurant_reviews rv join public.restaurants r on r.id = rv.restaurant_id
   where r.space_id = '0f00d001-0000-4000-8000-0000000000f1' and r.status = 'wishlist';
  if v_count <> 0 then
    v_fail := v_fail || format('wishlist 맛집에 후기 %s건', v_count);
  end if;

  if array_length(v_fail, 1) is not null then
    raise exception 'FOOD-001 동시성 판정 실패: %', array_to_string(v_fail, ' | ') using errcode = 'TS001';
  end if;
  raise notice 'FOOD-001 동시성 판정 통과(시나리오 6개)';
end;
$verify$;
