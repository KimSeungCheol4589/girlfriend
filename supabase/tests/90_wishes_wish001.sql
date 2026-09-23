-- WISH-001 테스트 90 — 일반 위시(wish_items)의 권한·검증·상태 전이·충돌·중복 요청
--
-- 확인 대상
--   * 로그인 사용자는 전용 RPC만 실행할 수 있고, 테이블 직접 쓰기는 막힌다
--   * 제목·분류·메모·링크 검증(HTTPS, 길이, 사용자 정보가 붙은 호스트)
--   * wish → planned → done 전이와 계획일 규칙('wish'에는 계획일이 없다, 미래 계획일은 정상)
--   * 두 구성원이 같은 위시를 함께 편집·전환·삭제한다
--   * 버전 충돌, 같은 requestId 재전송/다른 입력
--   * 외부 공간 구성원(C)·비로그인은 존재 여부를 알 수 없다
--
-- 합성 신원만 쓴다(.invalid). 파일 끝에서 ROLLBACK한다.

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\set ua '91111111-1111-4111-8111-111111111111'
\set ub '92222222-2222-4222-8222-222222222222'
\set uc '93333333-3333-4333-8333-333333333333'
\set s1 'a9a9a9a1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
\set s2 'a9a9a9a2-aaaa-4aaa-8aaa-aaaaaaaaaaa2'

select tests_support.make_user(:'ua', 'wish90-a@test.invalid');
select tests_support.make_user(:'ub', 'wish90-b@test.invalid');
select tests_support.make_user(:'uc', 'wish90-c@test.invalid');
select tests_support.make_profile(:'ua', '에이');
select tests_support.make_profile(:'ub', '비이');
select tests_support.make_profile(:'uc', '씨이');
select tests_support.make_space(:'s1', :'ua', '위시 공간');
select tests_support.add_member(:'s1', :'ub');
select tests_support.make_space(:'s2', :'uc', '다른 공간');

-- ---------------------------------------------------------------------------
-- 권한 (역할 전환 전에 카탈로그로 확인한다)
-- ---------------------------------------------------------------------------
select tests_support.ok(
  has_function_privilege('authenticated',
    'public.save_wish(uuid,text,text,text,text,integer,uuid)', 'EXECUTE'),
  'authenticated는 save_wish를 실행할 수 있다');
select tests_support.ok(
  has_function_privilege('authenticated',
    'public.set_wish_status(uuid,text,date,integer,uuid)', 'EXECUTE'),
  'authenticated는 set_wish_status를 실행할 수 있다');
select tests_support.ok(
  has_function_privilege('authenticated', 'public.delete_wish(uuid,integer,uuid)', 'EXECUTE'),
  'authenticated는 delete_wish를 실행할 수 있다');

select tests_support.ok(
  not has_function_privilege('anon', 'public.save_wish(uuid,text,text,text,text,integer,uuid)', 'EXECUTE'),
  'anon은 save_wish를 실행할 수 없다');
select tests_support.ok(
  not has_function_privilege('anon', 'public.set_wish_status(uuid,text,date,integer,uuid)', 'EXECUTE'),
  'anon은 set_wish_status를 실행할 수 없다');
select tests_support.ok(
  not has_function_privilege('anon', 'public.delete_wish(uuid,integer,uuid)', 'EXECUTE'),
  'anon은 delete_wish를 실행할 수 없다');

select tests_support.ok(
  not has_function_privilege('authenticated', 'app_private.wish_link_problem(text)', 'EXECUTE'),
  '내부 링크 검사 헬퍼는 로그인 사용자에게 노출되지 않는다');

-- 소유자(postgres)는 마이그레이션·복구 경로다. 클라이언트·서비스 역할만 본다(DB-001 20번과 같은 기준).
select tests_support.ok(
  not exists (
    select 1 from information_schema.role_table_grants g
     where g.table_schema = 'public' and g.table_name = 'wish_items'
       and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
       and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  'wish_items에는 클라이언트·서비스 역할의 직접 쓰기 권한이 없다');

select tests_support.ok(
  (select c.relrowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'wish_items'),
  'wish_items에 RLS가 켜져 있다');

-- ---------------------------------------------------------------------------
-- A: 생성, 입력 검증, 중복 요청
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare
  v_result jsonb;
  v_wish   uuid;
  v_req    uuid := gen_random_uuid();
  v_again  jsonb;
begin
  v_result := public.save_wish(null, '한강 야경 보기', 'activity', '자전거 타고', null, 0, v_req);
  v_wish := (v_result ->> 'wishId')::uuid;
  perform tests_support.put('w1', v_wish::text);
  perform tests_support.eq(v_result ->> 'status', 'wish', '새 위시는 wish 상태');
  perform tests_support.eq(v_result ->> 'category', 'activity', '분류가 저장된다');
  perform tests_support.eq((v_result ->> 'version')::integer, 1, '새 위시는 버전 1');

  -- 같은 requestId·같은 입력 재전송은 같은 결과, 행은 하나
  v_again := public.save_wish(null, '한강 야경 보기', 'activity', '자전거 타고', null, 0, v_req);
  perform tests_support.eq(v_again ->> 'wishId', v_wish::text, '재전송은 같은 위시 ID');
  perform tests_support.eq(
    (select count(*)::integer from public.wish_items w where w.title = '한강 야경 보기'),
    1, '재전송해도 위시는 한 건이다');

  -- 같은 requestId·다른 입력은 거부
  perform tests_support.expect_error(
    format($q$select public.save_wish(null, '다른 제목', 'other', '', null, 0, %L)$q$, v_req),
    'GF409', '같은 requestId에 다른 입력은 CONFLICT');

  -- 입력 검증
  perform tests_support.expect_error(
    $q$select public.save_wish(null, '   ', 'other', '', null, 0, gen_random_uuid())$q$,
    'GF422', '빈 제목 거부');
  perform tests_support.expect_error(
    $q$select public.save_wish(null, repeat('가', 101), 'other', '', null, 0, gen_random_uuid())$q$,
    'GF422', '101자 제목 거부');
  perform tests_support.expect_error(
    $q$select public.save_wish(null, '분류', 'restaurant', '', null, 0, gen_random_uuid())$q$,
    'GF422', '허용되지 않은 분류 거부');
  perform tests_support.expect_error(
    $q$select public.save_wish(null, '메모', 'other', repeat('가', 2001), null, 0, gen_random_uuid())$q$,
    'GF422', '2001자 메모 거부');
  perform tests_support.expect_error(
    $q$select public.save_wish(null, '새 위시', 'other', '', null, 3, gen_random_uuid())$q$,
    'GF422', '생성인데 expectedVersion이 0이 아니면 거부');

  -- 링크: HTTPS만, 길이, 사용자 정보가 붙은 호스트 거부. 서버는 링크를 가져오지 않는다.
  perform tests_support.expect_error(
    $q$select public.save_wish(null, 'http 링크', 'other', '', 'http://example.invalid/a', 0, gen_random_uuid())$q$,
    'GF422', 'http 링크 거부');
  perform tests_support.expect_error(
    $q$select public.save_wish(null, '대문자', 'other', '', 'HTTPS://example.invalid/a', 0, gen_random_uuid())$q$,
    'GF422', '대문자 스킴 거부');
  perform tests_support.expect_error(
    $q$select public.save_wish(null, '스크립트', 'other', '', 'javascript:alert(1)', 0, gen_random_uuid())$q$,
    'GF422', 'javascript: 링크 거부');
  perform tests_support.expect_error(
    $q$select public.save_wish(null, '공백', 'other', '', 'https://exa mple.invalid/a', 0, gen_random_uuid())$q$,
    'GF422', '공백이 든 링크 거부');
  perform tests_support.expect_error(
    $q$select public.save_wish(null, '짧은', 'other', '', 'https://a', 0, gen_random_uuid())$q$,
    'GF422', '11자 미만 링크 거부');
  perform tests_support.expect_error(
    format($q$select public.save_wish(null, '긴', 'other', '', %L, 0, gen_random_uuid())$q$,
           'https://example.invalid/' || repeat('a', 500)),
    'GF422', '500자 초과 링크 거부');
  perform tests_support.expect_error(
    $q$select public.save_wish(null, '사용자정보', 'other', '', 'https://trusted.invalid@evil.invalid/a', 0, gen_random_uuid())$q$,
    'GF422', '사용자 정보가 붙은 링크 거부');

  -- 허용되는 링크(호스트 허용 목록 없음)
  v_result := public.save_wish(null, '전시 보러 가기', 'place', '', 'https://example.invalid/exhibit', 0, gen_random_uuid());
  perform tests_support.put('w2', v_result ->> 'wishId');
  perform tests_support.eq(
    (select w.link_url from public.wish_items w where w.id = (v_result ->> 'wishId')::uuid),
    'https://example.invalid/exhibit', 'HTTPS 링크는 그대로 저장된다');
end;
$do$;

-- ---------------------------------------------------------------------------
-- A: 상태 전이와 계획일
-- ---------------------------------------------------------------------------
do $do$
declare
  v_wish   uuid := tests_support.get('w1')::uuid;
  v_result jsonb;
begin
  -- 'wish' 상태에는 계획일을 줄 수 없다
  perform tests_support.expect_error(
    format($q$select public.set_wish_status(%L, 'wish', current_date + 7, 1, gen_random_uuid())$q$, v_wish),
    'GF422', 'wish 상태에는 계획일을 줄 수 없다');
  perform tests_support.expect_error(
    format($q$select public.set_wish_status(%L, 'cancelled', null, 1, gen_random_uuid())$q$, v_wish),
    'GF422', '허용되지 않은 상태 거부');

  -- 미래 계획일은 정상이다(맛집 방문일과 다른 점)
  v_result := public.set_wish_status(v_wish, 'planned', current_date + 30, 1, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'status', 'planned', '계획됨으로 전환');
  perform tests_support.eq(v_result ->> 'plannedDate', (current_date + 30)::text, '미래 계획일 저장');
  perform tests_support.eq((v_result ->> 'version')::integer, 2, '상태 전환이 버전을 올린다');

  -- 계획일만 비우기(계획됨 유지)
  v_result := public.set_wish_status(v_wish, 'planned', null, 2, gen_random_uuid());
  perform tests_support.ok(v_result -> 'plannedDate' = 'null'::jsonb, '보낸 null이 그대로 저장된다');

  -- 버전 충돌
  perform tests_support.expect_error(
    format($q$select public.set_wish_status(%L, 'done', null, 2, gen_random_uuid())$q$, v_wish),
    'GF409', '낡은 expectedVersion은 CONFLICT');

  v_result := public.set_wish_status(v_wish, 'done', current_date - 1, 3, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'status', 'done', '완료로 전환');
  perform tests_support.eq(v_result ->> 'plannedDate', (current_date - 1)::text, '완료에도 날짜가 남는다');

  -- 'wish'로 되돌리면 계획일이 비워진다
  v_result := public.set_wish_status(v_wish, 'wish', null, 4, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'status', 'wish', '하고 싶음으로 되돌리기');
  perform tests_support.ok(v_result -> 'plannedDate' = 'null'::jsonb, '되돌리면 계획일이 비워진다');
  perform tests_support.eq(
    (select w.planned_date from public.wish_items w where w.id = v_wish),
    null::date, 'DB에도 계획일이 남지 않는다');
end;
$do$;

-- ---------------------------------------------------------------------------
-- A: 테이블 직접 쓰기 차단
-- ---------------------------------------------------------------------------
do $do$
declare
  v_wish uuid := tests_support.get('w1')::uuid;
begin
  perform tests_support.expect_error(
    format($q$insert into public.wish_items (space_id, created_by, title)
              values (%L, %L, '직접 삽입')$q$,
           'a9a9a9a1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '91111111-1111-4111-8111-111111111111'),
    '42501', '로그인 사용자는 wish_items에 직접 INSERT할 수 없다');
  perform tests_support.expect_error(
    format($q$update public.wish_items set title = '직접 수정' where id = %L$q$, v_wish),
    '42501', '로그인 사용자는 wish_items를 직접 UPDATE할 수 없다');
  perform tests_support.expect_error(
    format($q$delete from public.wish_items where id = %L$q$, v_wish),
    '42501', '로그인 사용자는 wish_items를 직접 DELETE할 수 없다');
end;
$do$;

-- ---------------------------------------------------------------------------
-- B: 상대 구성원도 같은 위시를 편집·전환·삭제한다
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

do $do$
declare
  v_wish   uuid := tests_support.get('w1')::uuid;
  v_w2     uuid := tests_support.get('w2')::uuid;
  v_result jsonb;
begin
  perform tests_support.eq(
    (select count(*)::integer from public.wish_items w where w.id in (v_wish, v_w2)),
    2, 'B도 공간의 위시를 모두 본다');

  -- 공동 편집: 작성자가 아니어도 수정할 수 있다
  v_result := public.save_wish(v_wish, '한강 야경 보기(수정)', 'trip', 'B가 고침', 'https://example.invalid/b', 5, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, 6, 'B의 수정이 버전을 올린다');
  perform tests_support.eq(
    (select w.created_by from public.wish_items w where w.id = v_wish),
    '91111111-1111-4111-8111-111111111111'::uuid, '작성자는 바뀌지 않는다');

  -- 공동 상태 전환
  v_result := public.set_wish_status(v_wish, 'planned', current_date + 3, 6, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'status', 'planned', 'B도 상태를 바꿀 수 있다');

  -- 삭제: 낡은 버전은 아무것도 지우지 않는다
  perform tests_support.expect_error(
    format($q$select public.delete_wish(%L, 6, gen_random_uuid())$q$, v_w2),
    'GF409', '낡은 버전의 삭제는 CONFLICT');
  perform tests_support.eq(
    (select count(*)::integer from public.wish_items w where w.id = v_w2), 1, '거부된 삭제는 행을 남긴다');

  v_result := public.delete_wish(v_w2, 1, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'wishId', v_w2::text, 'B가 위시를 삭제한다');
  perform tests_support.eq(
    (select count(*)::integer from public.wish_items w where w.id = v_w2), 0, '삭제된 위시는 사라진다');

  -- 이미 사라진 위시는 NOT_FOUND
  perform tests_support.expect_error(
    format($q$select public.delete_wish(%L, 1, gen_random_uuid())$q$, v_w2),
    'GF404', '없는 위시 삭제는 NOT_FOUND');
end;
$do$;

-- ---------------------------------------------------------------------------
-- C(외부 공간): 존재 여부를 알 수 없다
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'uc'), true);
select set_config('request.jwt.claim.sub', :'uc', true);
set local role authenticated;

do $do$
declare
  v_wish uuid := tests_support.get('w1')::uuid;
begin
  perform tests_support.eq(
    (select count(*)::integer from public.wish_items w where w.id = v_wish),
    0, '외부 공간 계정에게는 위시가 보이지 않는다');
  perform tests_support.expect_error(
    format($q$select public.save_wish(%L, '가로채기', 'other', '', null, 7, gen_random_uuid())$q$, v_wish),
    'GF404', '외부 계정의 수정은 NOT_FOUND');
  perform tests_support.expect_error(
    format($q$select public.set_wish_status(%L, 'done', null, 7, gen_random_uuid())$q$, v_wish),
    'GF404', '외부 계정의 상태 전환은 NOT_FOUND');
  perform tests_support.expect_error(
    format($q$select public.delete_wish(%L, 7, gen_random_uuid())$q$, v_wish),
    'GF404', '외부 계정의 삭제는 NOT_FOUND');
end;
$do$;

-- ---------------------------------------------------------------------------
-- 비로그인(anon)
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

-- anon에는 SELECT 권한 자체가 없다(RLS 이전 단계에서 막힌다).
select tests_support.expect_error(
  'select id from public.wish_items', '42501', '비로그인은 위시를 볼 수 없다');
select tests_support.expect_error(
  $q$select public.save_wish(null, '비로그인', 'other', '', null, 0, gen_random_uuid())$q$,
  '42501', '비로그인은 save_wish를 호출할 수 없다');
select tests_support.expect_error(
  $q$select public.set_wish_status(gen_random_uuid(), 'done', null, 1, gen_random_uuid())$q$,
  '42501', '비로그인은 set_wish_status를 호출할 수 없다');
select tests_support.expect_error(
  $q$select public.delete_wish(gen_random_uuid(), 1, gen_random_uuid())$q$,
  '42501', '비로그인은 delete_wish를 호출할 수 없다');

reset role;
rollback;
