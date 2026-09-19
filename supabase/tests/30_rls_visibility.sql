-- DB-001 테스트 30 — RLS 조회 가시성
--
-- 구성원 A·B가 한 공간, 외부 사용자 C가 다른 공간에 있다.
-- 확인 대상
--   * 외부 계정과 비로그인은 공간 데이터를 볼 수 없다.
--   * 프로필은 본인과 같은 공간 구성원만 보인다.
--   * 파일은 업로더 본인 또는 "ready + 실제 첨부"일 때만 상대에게 보인다.
--   * 개인 후기는 두 구성원 모두 조회할 수 있다.

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\set ua '11111111-1111-4111-8111-111111111111'
\set ub '22222222-2222-4222-8222-222222222222'
\set uc '33333333-3333-4333-8333-333333333333'
\set s1 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
\set s2 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
\set mem1 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
\set apending 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
\set aunattached 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
\set aattached 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'
\set acover 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4'
\set adeleting 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'
\set rest1 'ffffffff-ffff-4fff-8fff-fffffffffff1'

select tests_support.make_user(:'ua', 'a.member@test.invalid');
select tests_support.make_user(:'ub', 'b.member@test.invalid');
select tests_support.make_user(:'uc', 'c.outsider@test.invalid');
select tests_support.make_profile(:'ua', '에이');
select tests_support.make_profile(:'ub', '비이');
select tests_support.make_profile(:'uc', '씨이');
select tests_support.make_space(:'s1', :'ua', '우리 공간');
select tests_support.add_member(:'s1', :'ub');
select tests_support.make_space(:'s2', :'uc', '외부 공간');

select tests_support.make_memory(:'mem1', :'s1', :'ua', '첫 추억');

-- A가 올린 파일 4종
select tests_support.make_asset(:'apending',    :'s1', :'ua', 'memory', 'pending');
select tests_support.make_asset(:'aunattached', :'s1', :'ua', 'memory', 'ready');
select tests_support.make_asset(:'aattached',   :'s1', :'ua', 'memory', 'ready');
select tests_support.make_asset(:'acover',      :'s1', :'ua', 'cover',  'ready');
select tests_support.make_asset(:'adeleting',   :'s1', :'ua', 'memory', 'ready');

insert into public.memory_photos (memory_id, space_id, asset_id, sort_order)
values (:'mem1', :'s1', :'aattached', 0);

update public.space_settings set cover_asset_id = :'acover', version = version + 1
 where space_id = :'s1';

update public.assets set state = 'deleting' where id = :'adeleting';

-- 방문 완료 맛집과 두 사람의 후기
select tests_support.make_restaurant(:'rest1', :'s1', :'ua', 'visited');
insert into public.restaurant_reviews (restaurant_id, space_id, user_id, rating, comment)
values (:'rest1', :'s1', :'ua', 5, 'A의 후기'),
       (:'rest1', :'s1', :'ub', 4, 'B의 후기');

set constraints all immediate;

-- ---------------------------------------------------------------------------
-- 비로그인
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select tests_support.expect_error('select * from public.spaces', '42501', 'anon: spaces 거부');
select tests_support.expect_error('select * from public.profiles', '42501', 'anon: profiles 거부');
select tests_support.expect_error('select * from public.restaurant_reviews', '42501', 'anon: 후기 거부');

-- 정책이 호출하는 헬퍼는 실행할 수 있지만 남의 파일에 대해서는 아무것도 알려주지 않아야 한다.
select tests_support.ok(
  app.is_asset_attached('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3') = false,
  'anon은 파일 첨부 여부를 알 수 없다');

-- ---------------------------------------------------------------------------
-- 구성원 A
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

select tests_support.eq((select count(*) from public.spaces)::bigint, 1::bigint,
  'A는 자기 공간 1개만 본다');
select tests_support.eq((select count(*) from public.space_members)::bigint, 2::bigint,
  'A는 구성원 2명을 본다');
select tests_support.eq((select count(*) from public.profiles)::bigint, 2::bigint,
  'A는 본인과 상대 프로필만 본다');
select tests_support.eq((select count(*) from public.memories)::bigint, 1::bigint,
  'A는 공간 추억을 본다');
select tests_support.eq((select count(*) from public.restaurant_reviews)::bigint, 2::bigint,
  'A는 두 사람의 후기를 본다');
select tests_support.eq((select count(*) from public.assets)::bigint, 5::bigint,
  'A는 자기가 올린 파일 5개를 모두 본다');

-- ---------------------------------------------------------------------------
-- 구성원 B — 상대가 올린 미저장 파일은 보이지 않아야 한다
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

select tests_support.eq((select count(*) from public.memories)::bigint, 1::bigint,
  'B도 같은 추억을 본다');
select tests_support.eq((select count(*) from public.restaurant_reviews)::bigint, 2::bigint,
  'B도 두 사람의 후기를 본다');

select tests_support.eq((select count(*) from public.assets)::bigint, 2::bigint,
  'B에게는 첨부된 ready 파일 2개(사진·커버)만 보인다');

select tests_support.ok(
  not exists (select 1 from public.assets a where a.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'),
  'B에게 상대의 pending 파일은 보이지 않는다');
select tests_support.ok(
  not exists (select 1 from public.assets a where a.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'),
  'B에게 상대의 미첨부 ready 파일은 보이지 않는다');
select tests_support.ok(
  not exists (select 1 from public.assets a where a.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'),
  'B에게 상대의 deleting 파일은 보이지 않는다');
select tests_support.ok(
  exists (select 1 from public.assets a where a.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'),
  'B에게 첨부된 사진 파일은 보인다');
select tests_support.ok(
  exists (select 1 from public.assets a where a.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4'),
  'B에게 커버 파일은 보인다');

-- 같은 공간 구성원에게는 첨부 여부가 정확히 나와야 한다(정책 의미 유지).
select tests_support.ok(
  app.is_asset_attached('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'),
  'B는 같은 공간 파일의 첨부 여부를 확인할 수 있다');
select tests_support.ok(
  app.is_asset_attached('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2') = false,
  '미첨부 파일은 첨부 아님으로 나온다');

-- ---------------------------------------------------------------------------
-- 외부 계정 C
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'uc'), true);
select set_config('request.jwt.claim.sub', :'uc', true);
set local role authenticated;

select tests_support.ok(
  not exists (select 1 from public.spaces s where s.id = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'C에게 남의 공간은 보이지 않는다');
select tests_support.eq((select count(*) from public.memories)::bigint, 0::bigint,
  'C에게 남의 추억은 보이지 않는다');
select tests_support.eq((select count(*) from public.memory_photos)::bigint, 0::bigint,
  'C에게 남의 사진 연결은 보이지 않는다');
select tests_support.eq((select count(*) from public.assets)::bigint, 0::bigint,
  'C에게 남의 파일은 보이지 않는다');
select tests_support.eq((select count(*) from public.restaurant_reviews)::bigint, 0::bigint,
  'C에게 남의 후기는 보이지 않는다');
select tests_support.eq((select count(*) from public.space_settings)::bigint, 1::bigint,
  'C는 자기 공간 설정만 본다');
select tests_support.eq((select count(*) from public.profiles)::bigint, 1::bigint,
  'C는 자기 프로필만 본다');

-- 외부 계정이 asset UUID를 알아내도 첨부 여부라는 사실조차 얻지 못해야 한다(검토 지적 D6).
select tests_support.ok(
  app.is_asset_attached('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3') = false,
  'C는 남의 공간 파일의 첨부 여부를 알 수 없다');
select tests_support.ok(
  app.is_asset_attached('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4') = false,
  'C는 남의 공간 커버의 첨부 여부를 알 수 없다');

-- 특정 ID를 직접 지정해도 결과가 없어야 한다(존재 여부 추측 방지).
select tests_support.expect_no_rows(
  $q$select id from public.memories where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'$q$,
  'C의 직접 ID 조회도 0행');
select tests_support.expect_no_rows(
  $q$select id from public.assets where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'$q$,
  'C의 파일 직접 ID 조회도 0행');

reset role;
rollback;

\echo '30_rls_visibility.sql 완료 (모든 변경 롤백)'
