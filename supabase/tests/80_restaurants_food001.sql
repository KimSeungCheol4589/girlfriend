-- FOOD-001 테스트 80 — 맛집 공동 편집, 후기 삭제 확인, 개인 후기 권한
--
-- 확인 대상
--   * delete_restaurant_confirmed: 후기가 있으면 명시적 확인 없이는 아무것도 바꾸지 않는다
--   * 확인 없는 이전 delete_restaurant는 로그인 사용자가 실행할 수 없다
--   * 두 구성원 모두 맛집 정보·상태를 바꿀 수 있고, 후기는 본인 것만 바꾼다
--   * 방문 상태·방문일 불변식(미래 날짜, wishlist의 방문일)
--   * 버전 충돌, 같은 requestId 재전송/다른 입력
--   * (FOOD-001 마이그레이션 2) 후기 저장·수정·삭제가 맛집 버전을 올려, 확인 뒤 바뀐 후기를
--     확인형 삭제·방문 취소·정보 수정이 CONFLICT로 알아챈다. 재전송은 버전을 다시 올리지 않는다.
--   * 외부 공간 구성원(C)·비로그인은 존재 여부를 알 수 없다
--
-- 합성 신원만 쓴다(.invalid). 파일 끝에서 ROLLBACK한다.

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\set ua '81111111-1111-4111-8111-111111111111'
\set ub '82222222-2222-4222-8222-222222222222'
\set uc '83333333-3333-4333-8333-333333333333'
\set s1 'a8a8a8a1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
\set s2 'a8a8a8a2-aaaa-4aaa-8aaa-aaaaaaaaaaa2'

select tests_support.make_user(:'ua', 'food80-a@test.invalid');
select tests_support.make_user(:'ub', 'food80-b@test.invalid');
select tests_support.make_user(:'uc', 'food80-c@test.invalid');
select tests_support.make_profile(:'ua', '에이');
select tests_support.make_profile(:'ub', '비이');
select tests_support.make_profile(:'uc', '씨이');
select tests_support.make_space(:'s1', :'ua', '맛집 공간');
select tests_support.add_member(:'s1', :'ub');
select tests_support.make_space(:'s2', :'uc', '다른 공간');

-- ---------------------------------------------------------------------------
-- 권한
-- ---------------------------------------------------------------------------
select tests_support.ok(
  has_function_privilege('authenticated',
    'public.delete_restaurant_confirmed(uuid,boolean,integer,uuid)', 'EXECUTE'),
  'authenticated는 확인형 삭제를 실행할 수 있다');
select tests_support.ok(
  not has_function_privilege('anon',
    'public.delete_restaurant_confirmed(uuid,boolean,integer,uuid)', 'EXECUTE'),
  'anon은 확인형 삭제를 실행할 수 없다');
select tests_support.ok(
  not has_function_privilege('authenticated', 'public.delete_restaurant(uuid,integer,uuid)', 'EXECUTE'),
  '확인 없는 이전 삭제는 authenticated가 실행할 수 없다');

-- ---------------------------------------------------------------------------
-- A: 등록, 상태 불변식
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare
  v_result jsonb;
  v_rest   uuid;
  v_req    uuid := gen_random_uuid();
  v_again  jsonb;
begin
  v_result := public.save_restaurant(null, '성수 파스타', '성수', '양식',
                'https://map.naver.com/p/entry/place/1', '창가 자리', 0, v_req);
  v_rest := (v_result ->> 'restaurantId')::uuid;
  perform tests_support.put('r1', v_rest::text);
  perform tests_support.eq(v_result ->> 'status', 'wishlist', '새 맛집은 wishlist');

  -- 같은 requestId·같은 입력 재전송은 같은 결과, 행은 하나
  v_again := public.save_restaurant(null, '성수 파스타', '성수', '양식',
               'https://map.naver.com/p/entry/place/1', '창가 자리', 0, v_req);
  perform tests_support.eq(v_again ->> 'restaurantId', v_rest::text, '재전송은 같은 맛집 ID');

  -- 같은 requestId·다른 입력은 거부
  perform tests_support.expect_error(
    format($q$select public.save_restaurant(null, '다른 이름', '', '', null, '', 0, %L)$q$, v_req),
    'GF409', '같은 requestId에 다른 입력은 CONFLICT');

  -- 지도 링크: 포트·사용자 정보가 붙은 주소는 호스트가 달라 거부
  perform tests_support.expect_error(
    $q$select public.save_restaurant(null, '포트', '', '', 'https://map.naver.com:444/x', '', 0, gen_random_uuid())$q$,
    'GF422', '포트가 붙은 지도 링크 거부');
  perform tests_support.expect_error(
    $q$select public.save_restaurant(null, '사용자', '', '', 'https://user@map.naver.com/x', '', 0, gen_random_uuid())$q$,
    'GF422', '사용자 정보가 붙은 지도 링크 거부');
  perform tests_support.expect_error(
    $q$select public.save_restaurant(null, 'http', '', '', 'http://map.naver.com/x', '', 0, gen_random_uuid())$q$,
    'GF422', 'http 지도 링크 거부');

  -- 방문일 불변식 (한국 날짜 기준 오늘 이후 거부; UTC와의 차이를 넘도록 +2일)
  perform tests_support.expect_error(
    format($q$select public.set_restaurant_status(%L, 'visited', current_date + 2, false, 1, gen_random_uuid())$q$, v_rest),
    'GF422', '미래 방문일 거부');
  perform tests_support.expect_error(
    format($q$select public.set_restaurant_status(%L, 'wishlist', current_date - 1, false, 1, gen_random_uuid())$q$, v_rest),
    'GF422', 'wishlist에는 방문일을 줄 수 없다');
  perform tests_support.expect_error(
    format($q$select public.set_restaurant_status(%L, 'closed', null, false, 1, gen_random_uuid())$q$, v_rest),
    'GF422', '허용되지 않은 상태 거부');

  v_result := public.set_restaurant_status(v_rest, 'visited', current_date - 3, false, 1, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, 2, '방문 처리 후 버전 2');
  perform tests_support.eq(v_result ->> 'visitedDate', (current_date - 3)::text, '방문일 저장');

  v_result := public.save_review(v_rest, 5::smallint, 'A 후기', 0, gen_random_uuid());
  perform tests_support.put('review_a', v_result ->> 'reviewId');
  perform tests_support.eq((v_result ->> 'restaurantVersion')::integer, 3, '후기 작성이 맛집 버전을 3으로 올린다');
end;
$do$;

-- ---------------------------------------------------------------------------
-- B: 공동 편집, 본인 후기만
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

do $do$
declare
  v_result jsonb;
  v_rest   uuid := tests_support.get('r1')::uuid;
begin
  -- A가 만든 맛집을 B도 수정할 수 있다(공유 기록).
  -- A의 후기 작성 전 버전(2)으로는 저장할 수 없다(후기 변화도 버전에 반영된다).
  perform tests_support.expect_error(
    format($q$select public.save_restaurant(%L, '후기 전 버전', '', '', null, '', 2, gen_random_uuid())$q$, v_rest),
    'GF409', '후기가 바뀌기 전 버전의 정보 수정은 CONFLICT');

  v_result := public.save_restaurant(v_rest, '성수 파스타 본점', '성수', '양식',
                null, 'B가 메모 수정', 3, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, 4, 'B의 정보 수정 후 버전 4');

  -- 오래된 버전으로 저장하면 조용히 덮어쓰지 않는다.
  perform tests_support.expect_error(
    format($q$select public.save_restaurant(%L, '덮어쓰기', '', '', null, '', 3, gen_random_uuid())$q$, v_rest),
    'GF409', '오래된 버전의 정보 수정은 CONFLICT');

  v_result := public.save_review(v_rest, 3::smallint, 'B 후기', 0, gen_random_uuid());
  perform tests_support.put('review_b', v_result ->> 'reviewId');
  perform tests_support.eq((v_result ->> 'restaurantVersion')::integer, 5, 'B 후기 작성 후 맛집 버전 5');

  -- 상대 후기 수정·삭제 불가 (save_review는 항상 호출자 본인 후기만 다룬다)
  perform tests_support.expect_error(
    format($q$select public.delete_review(%L, 1, gen_random_uuid())$q$, tests_support.get('review_a')),
    'GF404', 'B는 A의 후기를 지울 수 없다');

  -- 확인 없는 삭제: 후기가 있으므로 거부
  perform tests_support.expect_error(
    format($q$select public.delete_restaurant_confirmed(%L, false, 5, gen_random_uuid())$q$, v_rest),
    'GF409', '후기가 있으면 확인 없이 삭제할 수 없다');

  -- 후기 변화 이전 버전으로는 확인이 있어도 삭제할 수 없다.
  perform tests_support.expect_error(
    format($q$select public.delete_restaurant_confirmed(%L, true, 4, gen_random_uuid())$q$, v_rest),
    'GF409', '후기가 생기기 전 버전의 확인형 삭제는 CONFLICT');

  -- 이전 삭제 함수는 실행 권한이 없다
  perform tests_support.expect_error(
    format($q$select public.delete_restaurant(%L, 3, gen_random_uuid())$q$, v_rest),
    '42501', '이전 삭제 함수 직접 호출은 권한 거부');

  -- 직접 쓰기 불가
  perform tests_support.expect_error(
    format($q$insert into public.restaurant_reviews (restaurant_id, space_id, user_id, rating)
              values (%L, %L, %L, 1)$q$, v_rest, 'a8a8a8a1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
           '81111111-1111-4111-8111-111111111111'),
    '42501', '후기 테이블 직접 INSERT 거부');
  perform tests_support.expect_error(
    format($q$update public.restaurants set name = '직접' where id = %L$q$, v_rest),
    '42501', '맛집 테이블 직접 UPDATE 거부');
end;
$do$;

reset role;
select tests_support.eq(
  (select count(*) from public.restaurant_reviews rv where rv.restaurant_id = tests_support.get('r1')::uuid)::bigint,
  2::bigint, '확인 없는 삭제 시도 후 후기 2건 유지');
select tests_support.eq(
  (select count(*) from public.restaurants r where r.id = tests_support.get('r1')::uuid)::bigint,
  1::bigint, '확인 없는 삭제 시도 후 맛집 유지');
select tests_support.eq(
  (select rv.comment from public.restaurant_reviews rv where rv.id = tests_support.get('review_a')::uuid),
  'A 후기', 'A 후기는 그대로');

-- ---------------------------------------------------------------------------
-- C(다른 공간): 존재 여부를 알 수 없다
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'uc'), true);
select set_config('request.jwt.claim.sub', :'uc', true);
set local role authenticated;

select tests_support.expect_no_rows(
  format('select 1 from public.restaurants where id = %L', tests_support.get('r1')),
  'C는 다른 공간 맛집을 조회할 수 없다');
select tests_support.expect_no_rows(
  format('select 1 from public.restaurant_reviews where restaurant_id = %L', tests_support.get('r1')),
  'C는 다른 공간 후기를 조회할 수 없다');
select tests_support.expect_error(
  format($q$select public.delete_restaurant_confirmed(%L, true, 3, gen_random_uuid())$q$, tests_support.get('r1')),
  'GF404', 'C의 삭제는 NOT_FOUND');
select tests_support.expect_error(
  format($q$select public.save_review(%L, 1::smallint, '침입', 0, gen_random_uuid())$q$, tests_support.get('r1')),
  'GF404', 'C의 후기 작성은 NOT_FOUND');
select tests_support.expect_error(
  format($q$select public.set_restaurant_status(%L, 'wishlist', null, true, 3, gen_random_uuid())$q$, tests_support.get('r1')),
  'GF404', 'C의 상태 변경은 NOT_FOUND');

-- ---------------------------------------------------------------------------
-- 비로그인
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select tests_support.expect_error(
  'select * from public.restaurants', '42501', 'anon은 맛집을 조회할 수 없다');
select tests_support.expect_error(
  format($q$select public.delete_restaurant_confirmed(%L, true, 3, gen_random_uuid())$q$, tests_support.get('r1')),
  '42501', 'anon은 확인형 삭제를 실행할 수 없다');

reset role;
select tests_support.eq(
  (select count(*) from public.restaurant_reviews rv where rv.restaurant_id = tests_support.get('r1')::uuid)::bigint,
  2::bigint, '외부·비로그인 시도 후에도 후기 2건 유지');

-- ---------------------------------------------------------------------------
-- B: A가 버전 5(후기 2개)를 보고 확인 창을 연 사이 B가 자기 후기를 **수정**한다 → 버전 6
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

do $do$
declare
  v_result jsonb;
  v_req    uuid := gen_random_uuid();
  v_again  jsonb;
begin
  v_result := public.save_review(tests_support.get('r1')::uuid, 1::smallint, 'B 후기 수정됨', 1, v_req);
  perform tests_support.eq((v_result ->> 'restaurantVersion')::integer, 6, '후기 수정이 맛집 버전을 6으로 올린다');
  -- 재전송은 버전을 다시 올리지 않고 같은 결과를 준다.
  v_again := public.save_review(tests_support.get('r1')::uuid, 1::smallint, 'B 후기 수정됨', 1, v_req);
  perform tests_support.eq(v_again, v_result, '후기 저장 재전송은 같은 결과');
end;
$do$;

reset role;
select tests_support.eq(
  (select r.version from public.restaurants r where r.id = tests_support.get('r1')::uuid),
  6, '후기 저장 재전송은 맛집 버전을 다시 올리지 않는다');

-- ---------------------------------------------------------------------------
-- A: 수정된 후기 감지, 본인 후기 삭제, 확인된 삭제, 재전송, 확인 없는 삭제(후기 없음)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare
  v_result jsonb;
  v_again  jsonb;
  v_req    uuid := gen_random_uuid();
  v_rest   uuid := tests_support.get('r1')::uuid;
  v_empty  uuid;
begin
  -- A가 본 버전(5)은 B의 후기 수정 전이다. 확인이 있어도 지우지 않는다.
  perform tests_support.expect_error(
    format($q$select public.delete_restaurant_confirmed(%L, true, 5, gen_random_uuid())$q$, v_rest),
    'GF409', '확인 창을 연 뒤 후기가 수정되면 확인형 삭제는 CONFLICT');
  perform tests_support.expect_error(
    format($q$select public.set_restaurant_status(%L, 'wishlist', null, true, 5, gen_random_uuid())$q$, v_rest),
    'GF409', '확인 창을 연 뒤 후기가 수정되면 방문 취소는 CONFLICT');
  perform tests_support.eq(
    (select rv.comment from public.restaurant_reviews rv where rv.id = tests_support.get('review_b')::uuid),
    'B 후기 수정됨', '거부된 삭제·취소는 수정된 후기를 지우지 않는다');

  -- 본인 후기 삭제도 맛집 버전을 올린다.
  v_result := public.delete_review(tests_support.get('review_a')::uuid, 1, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'restaurantVersion')::integer, 7, '후기 삭제가 맛집 버전을 7로 올린다');
  perform tests_support.expect_error(
    format($q$select public.delete_restaurant_confirmed(%L, true, 6, gen_random_uuid())$q$, v_rest),
    'GF409', '후기가 지워진 뒤에는 이전 버전의 삭제도 CONFLICT');

  v_result := public.delete_restaurant_confirmed(v_rest, true, 7, v_req);
  perform tests_support.eq((v_result ->> 'deletedReviewCount')::integer, 1, '확인된 삭제는 남은 후기 1건을 함께 지운다');

  -- 응답 유실 후 재전송: 같은 결과를 돌려주고 오류가 나지 않는다.
  v_again := public.delete_restaurant_confirmed(v_rest, true, 7, v_req);
  perform tests_support.eq(v_again, v_result, '같은 requestId 재전송은 같은 삭제 결과');

  -- 같은 requestId를 다른 작업에 쓰면 거부
  perform tests_support.expect_error(
    format($q$select public.save_restaurant(null, '재사용', '', '', null, '', 0, %L)$q$, v_req),
    'GF409', '같은 requestId를 다른 작업에 쓰면 CONFLICT');

  -- 후기가 없는 맛집은 확인 플래그 없이 지울 수 있다.
  v_result := public.save_restaurant(null, '후기 없는 곳', '', '', null, '', 0, gen_random_uuid());
  v_empty := (v_result ->> 'restaurantId')::uuid;
  v_result := public.delete_restaurant_confirmed(v_empty, false, 1, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'deletedReviewCount')::integer, 0, '후기 없는 삭제');

  perform tests_support.expect_error(
    format($q$select public.delete_restaurant_confirmed(%L, false, 1, gen_random_uuid())$q$, v_empty),
    'GF404', '이미 지운 맛집은 NOT_FOUND');
end;
$do$;

reset role;
select tests_support.eq(
  (select count(*) from public.restaurants r where r.space_id = :'s1')::bigint, 0::bigint,
  '삭제 후 맛집이 남지 않는다');
select tests_support.eq(
  (select count(*) from public.restaurant_reviews rv where rv.space_id = :'s1')::bigint, 0::bigint,
  '삭제 후 후기가 남지 않는다');

rollback;

\echo '80_restaurants_food001.sql 완료 (모든 변경 롤백)'
