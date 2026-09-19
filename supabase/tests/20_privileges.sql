-- DB-001 테스트 20 — SQL 권한과 함수 노출
--
-- 확인 대상
--   * anon / authenticated / service_role의 직접 DML 차단
--   * 내부 헬퍼(app_private) 실행 차단
--   * 초대·중복요청 테이블 접근 차단
--   * RLS 헬퍼는 호출 가능하되 자기 정보만 반환

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\set ua '11111111-1111-4111-8111-111111111111'
\set ub '22222222-2222-4222-8222-222222222222'
\set uc '33333333-3333-4333-8333-333333333333'
\set s1 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'

select tests_support.make_user(:'ua', 'a.member@test.invalid');
select tests_support.make_user(:'ub', 'b.member@test.invalid');
select tests_support.make_user(:'uc', 'c.outsider@test.invalid');
select tests_support.make_profile(:'ua', '에이');
select tests_support.make_profile(:'ub', '비이');
select tests_support.make_profile(:'uc', '씨이');
select tests_support.make_space(:'s1', :'ua', '우리 공간');
select tests_support.add_member(:'s1', :'ub');

do $do$
declare
  v_mem uuid := 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
begin
  perform tests_support.make_memory(v_mem, 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                                    '11111111-1111-4111-8111-111111111111');
end;
$do$;

-- ---------------------------------------------------------------------------
-- 카탈로그 수준 권한 점검
-- ---------------------------------------------------------------------------
select tests_support.ok(
  not exists (
    select 1 from information_schema.role_table_grants g
     where g.table_schema = 'public'
       and g.grantee in ('anon', 'authenticated', 'PUBLIC')
       and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  'anon/authenticated에 직접 쓰기 권한이 없다');

select tests_support.ok(
  not exists (
    select 1 from information_schema.role_table_grants g
     where g.table_schema = 'public'
       and g.table_name in ('space_invites', 'mutation_requests')
       and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  '초대·중복요청 테이블에는 어떤 클라이언트 권한도 없다');

select tests_support.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app_private'
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  'app_private 함수는 클라이언트 역할이 실행할 수 없다');

select tests_support.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app', 'app_private')
       and p.prosecdef
       and (p.proconfig is null
            or not exists (select 1 from unnest(p.proconfig) as c(v) where c.v like 'search\_path=%'))),
  '모든 SECURITY DEFINER 함수에 고정 search_path가 있다');

select tests_support.ok(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) = 0,
  '모든 제품 테이블에 RLS가 켜져 있다');

select tests_support.ok(
  not has_function_privilege('anon', 'public.create_space(text,text,date,uuid)', 'EXECUTE'),
  'anon은 create_space를 실행할 수 없다');

select tests_support.ok(
  has_function_privilege('authenticated', 'public.create_space(text,text,date,uuid)', 'EXECUTE'),
  'authenticated는 create_space를 실행할 수 있다');

-- ---------------------------------------------------------------------------
-- 비로그인(anon)
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select tests_support.expect_error(
  'select * from public.spaces', '42501', 'anon은 spaces를 조회할 수 없다');
select tests_support.expect_error(
  'select * from public.memories', '42501', 'anon은 memories를 조회할 수 없다');
select tests_support.expect_error(
  'select * from public.assets', '42501', 'anon은 assets를 조회할 수 없다');
select tests_support.expect_error(
  'select * from public.space_invites', '42501', 'anon은 초대를 조회할 수 없다');
select tests_support.expect_error(
  'select * from public.mutation_requests', '42501', 'anon은 중복요청 기록을 조회할 수 없다');
select tests_support.expect_error(
  $q$insert into public.memories (space_id, author_id, title, memory_date)
     values ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
             '11111111-1111-4111-8111-111111111111', 'anon', current_date)$q$,
  '42501', 'anon은 추억을 만들 수 없다');
select tests_support.expect_error(
  $q$select public.create_space('침입 공간', '', null, gen_random_uuid())$q$,
  '42501', 'anon은 create_space를 호출할 수 없다');
select tests_support.expect_error(
  $q$select public.accept_invite('0123456789012345678901234567890123456789', gen_random_uuid())$q$,
  '42501', 'anon은 accept_invite를 호출할 수 없다');
select tests_support.expect_error(
  $q$select app_private.current_verified_email()$q$,
  '42501', 'anon은 내부 헬퍼를 호출할 수 없다');

-- RLS 헬퍼는 호출되지만 아무것도 반환하지 않는다.
select tests_support.ok(app.current_space_id() is null, 'anon의 current_space_id는 NULL');

-- ---------------------------------------------------------------------------
-- 로그인 구성원(A)
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

select tests_support.eq(app.current_space_id(), :'s1'::uuid, '구성원 A의 current_space_id');

select tests_support.ok(
  (select count(*) from public.memories) = 1, '구성원 A는 자기 공간 추억을 조회한다');

select tests_support.expect_error(
  $q$insert into public.memories (space_id, author_id, title, memory_date)
     values ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
             '11111111-1111-4111-8111-111111111111', '직접 삽입', current_date)$q$,
  '42501', '구성원도 추억을 직접 INSERT할 수 없다');

select tests_support.expect_error(
  $q$update public.memories set title = '직접 수정', version = version + 1$q$,
  '42501', '구성원도 추억을 직접 UPDATE할 수 없다');

select tests_support.expect_error(
  $q$delete from public.memories$q$,
  '42501', '구성원도 추억을 직접 DELETE할 수 없다');

select tests_support.expect_error(
  $q$insert into public.space_members (space_id, user_id)
     values ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '33333333-3333-4333-8333-333333333333')$q$,
  '42501', '구성원을 직접 추가할 수 없다');

select tests_support.expect_error(
  $q$update public.spaces set name = '이름 바꾸기', version = version + 1$q$,
  '42501', '공간 정보를 직접 UPDATE할 수 없다');

select tests_support.expect_error(
  $q$update public.assets set state = 'ready'$q$,
  '42501', '파일 상태를 직접 UPDATE할 수 없다');

select tests_support.expect_error(
  $q$select * from public.space_invites$q$,
  '42501', '구성원도 초대 행을 직접 조회할 수 없다');

select tests_support.expect_error(
  $q$select * from public.mutation_requests$q$,
  '42501', '구성원도 중복요청 기록을 조회할 수 없다');

-- 내부 헬퍼 직접 호출 차단
select tests_support.expect_error(
  $q$select app_private.require_user()$q$,
  '42501', 'require_user 직접 호출 차단');
select tests_support.expect_error(
  $q$select app_private.current_verified_email()$q$,
  '42501', 'current_verified_email 직접 호출 차단');
select tests_support.expect_error(
  $q$select app_private.is_bootstrap_creator('a.member@test.invalid')$q$,
  '42501', 'is_bootstrap_creator 직접 호출 차단');
select tests_support.expect_error(
  $q$select app_private.add_bootstrap_creator('evil@test.invalid')$q$,
  '42501', 'add_bootstrap_creator 직접 호출 차단');
select tests_support.expect_error(
  $q$select app_private.ensure_profile('33333333-3333-4333-8333-333333333333')$q$,
  '42501', 'ensure_profile 직접 호출 차단');
select tests_support.expect_error(
  $q$select app_private.begin_request('11111111-1111-4111-8111-111111111111',
        gen_random_uuid(), 'fake', '{}'::jsonb)$q$,
  '42501', 'begin_request 직접 호출 차단');
select tests_support.expect_error(
  $q$select app_private.expire_stale_assets(10)$q$,
  '42501', 'expire_stale_assets 직접 호출 차단');
select tests_support.expect_error(
  $q$select app_private.hash_token('x')$q$,
  '42501', 'hash_token 직접 호출 차단');

-- auth 스키마 직접 조회 차단(이메일 열람 방지)
select tests_support.expect_error(
  $q$select email from auth.users$q$,
  '42501', 'authenticated는 auth.users를 조회할 수 없다');

-- ---------------------------------------------------------------------------
-- service_role: 조회는 되지만 직접 쓰기는 막힌다
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;

select tests_support.ok(
  (select count(*) from public.memories) >= 1, 'service_role은 조회할 수 있다');

select tests_support.expect_error(
  $q$insert into public.memories (space_id, author_id, title, memory_date)
     values ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
             '11111111-1111-4111-8111-111111111111', 'service', current_date)$q$,
  '42501', 'service_role도 직접 INSERT할 수 없다');

select tests_support.expect_error(
  $q$select * from public.space_invites$q$,
  '42501', 'service_role도 초대 행을 조회할 수 없다');

reset role;
rollback;

\echo '20_privileges.sql 완료 (모든 변경 롤백)'
