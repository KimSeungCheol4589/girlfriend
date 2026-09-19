-- DB-001 테스트 60 — 지연 제약 트리거가 로그인 역할 컨텍스트에서 실행되는지 (회귀)
--
-- 배경(실제로 발생한 결함)
--   지연 제약 트리거는 SECURITY DEFINER RPC가 반환된 뒤 COMMIT 시점에 실행된다.
--   그때 본문은 정의자(postgres)가 아니라 **호출자 역할(authenticated)** 로 돌아간다.
--   그래서 tg_space_member_limit의 지역 변수 초기화가 app_private.config_int를 호출하는 순간
--   'permission denied for schema app_private'(42501)가 나서
--   accept_invite는 성공을 반환했는데 COMMIT이 실패했다. 두 초대 수락이 모두 롤백됐다.
--
-- 이 파일은 그 경로를 명시적으로 다시 밟는다.
--   SET CONSTRAINTS ALL IMMEDIATE를 **authenticated 역할로** 실행하면
--   보류 중인 지연 이벤트가 그 자리에서, COMMIT 때와 같은 보안 컨텍스트로 실행된다.
--   따라서 롤백 테스트 안에서도 커밋 시점 동작을 재현할 수 있다.
--   실제 COMMIT 경로는 supabase/tests/concurrency 러너가 함께 검증한다.
--
-- 각 검사 뒤에 SET CONSTRAINTS ALL DEFERRED로 되돌려 다음 검사도 지연 경로를 타게 한다.

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\set ua '11111111-1111-4111-8111-111111111111'
\set ub '22222222-2222-4222-8222-222222222222'

select tests_support.make_user(:'ua', 'a.member@test.invalid');
select tests_support.make_user(:'ub', 'b.member@test.invalid');
select app_private.add_bootstrap_creator('a.member@test.invalid', 'DB-001 회귀 테스트');

-- ---------------------------------------------------------------------------
-- 0) 카탈로그 확인 — 트리거 함수는 SECURITY DEFINER + 고정 search_path여야 한다
-- ---------------------------------------------------------------------------
select tests_support.ok(
  not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace cn on cn.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
     where not t.tgisinternal
       and cn.nspname = 'public'
       and (not p.prosecdef
            or p.proconfig is null
            or not exists (select 1 from unnest(p.proconfig) as cfg(v)
                            where cfg.v like 'search\_path=%'))),
  '모든 트리거 함수가 SECURITY DEFINER + 고정 search_path다');

select tests_support.ok(
  (select count(*) from pg_trigger t
    where not t.tgisinternal and t.tgdeferrable) >= 2,
  '지연 제약 트리거가 존재한다(정원·사진 집합)');

-- ---------------------------------------------------------------------------
-- 1) 공간 생성 — space_members 지연 정원 트리거
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

-- 트리거 함수 자체는 여전히 직접 호출할 수 없다.
select tests_support.expect_error(
  $q$select app_private.tg_space_member_limit()$q$,
  '42501', '지연 트리거 함수는 직접 호출할 수 없다');
select tests_support.expect_error(
  $q$select app_private.tg_memory_photo_set_guard()$q$,
  '42501', '사진 집합 트리거 함수는 직접 호출할 수 없다');
select tests_support.expect_error(
  $q$select app_private.config_int('space_member_limit', 2)$q$,
  '42501', '설정 헬퍼는 직접 호출할 수 없다');

do $do$
declare v_result jsonb;
begin
  v_result := public.create_space('우리 공간', '회귀 테스트', null,
                                  '99999999-9999-4999-8999-999999999801');
  perform tests_support.put('space_id', v_result ->> 'spaceId');
end;
$do$;

-- 여기서 예전 코드는 42501로 실패했다.
select tests_support.ok(
  tests_support.try_sqlstate('set constraints all immediate') is null,
  '공간 생성의 지연 정원 트리거가 로그인 역할에서 정상 실행된다');
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- 2) 초대 수락 — 같은 트리거, 두 번째 구성원
-- ---------------------------------------------------------------------------
do $do$
declare v_invite jsonb;
begin
  v_invite := public.create_invite('b.member@test.invalid', gen_random_uuid());
  perform tests_support.put('token', v_invite ->> 'token');
end;
$do$;

reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

do $do$
declare v_result jsonb;
begin
  v_result := public.accept_invite(tests_support.get('token'),
                                   '99999999-9999-4999-8999-999999999802');
  perform tests_support.eq(v_result ->> 'spaceId', tests_support.get('space_id'),
    'B가 초대를 수락한다');
end;
$do$;

-- 예전 코드가 실제로 깨졌던 지점: 수락은 성공했는데 커밋이 실패했다.
select tests_support.ok(
  tests_support.try_sqlstate('set constraints all immediate') is null,
  '초대 수락의 지연 정원 트리거가 로그인 역할에서 정상 실행된다');
set constraints all deferred;

reset role;
select tests_support.eq(
  (select count(*) from public.space_members m
    where m.space_id = tests_support.get('space_id')::uuid)::bigint,
  2::bigint, '두 구성원이 실제로 남아 있다');

-- ---------------------------------------------------------------------------
-- 3) 추억 사진 — memory_photos 지연 집합 트리거
-- ---------------------------------------------------------------------------
-- 준비는 A가, 확정은 신뢰된 서버 역할이 한다.
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare v_prep jsonb;
begin
  v_prep := public.prepare_upload('memory', 'image/webp', 2048, gen_random_uuid());
  perform tests_support.put('asset1', v_prep ->> 'assetId');
  v_prep := public.prepare_upload('memory', 'image/webp', 2048, gen_random_uuid());
  perform tests_support.put('asset2', v_prep ->> 'assetId');
  v_prep := public.prepare_upload('memory', 'image/webp', 2048, gen_random_uuid());
  perform tests_support.put('asset3', v_prep ->> 'assetId');
end;
$do$;

reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;

do $do$
begin
  perform public.finalize_upload(tests_support.get('asset1')::uuid, '11111111-1111-4111-8111-111111111111',
    2048, 800, 600, 'image/webp', gen_random_uuid());
  perform public.finalize_upload(tests_support.get('asset2')::uuid, '11111111-1111-4111-8111-111111111111',
    2048, 800, 600, 'image/webp', gen_random_uuid());
  perform public.finalize_upload(tests_support.get('asset3')::uuid, '11111111-1111-4111-8111-111111111111',
    2048, 800, 600, 'image/webp', gen_random_uuid());
end;
$do$;

reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare v_result jsonb;
begin
  v_result := public.save_memory(null, '사진 세 장', '', current_date - 1, null,
                array[]::text[],
                array[tests_support.get('asset1')::uuid,
                      tests_support.get('asset2')::uuid,
                      tests_support.get('asset3')::uuid],
                false, 0, '99999999-9999-4999-8999-999999999803');
  perform tests_support.put('memory_id', v_result ->> 'memoryId');
  perform tests_support.eq((v_result ->> 'photoCount')::integer, 3, '사진 3장 연결');
end;
$do$;

select tests_support.ok(
  tests_support.try_sqlstate('set constraints all immediate') is null,
  '사진 연결의 지연 집합 트리거가 로그인 역할에서 정상 실행된다');
set constraints all deferred;

-- 재정렬(순서 뒤집기)도 같은 경로를 탄다.
do $do$
declare v_result jsonb;
begin
  v_result := public.save_memory(tests_support.get('memory_id')::uuid, '사진 세 장', '',
                current_date - 1, null, array[]::text[],
                array[tests_support.get('asset3')::uuid,
                      tests_support.get('asset2')::uuid,
                      tests_support.get('asset1')::uuid],
                false, 1, '99999999-9999-4999-8999-999999999804');
  perform tests_support.eq((v_result ->> 'version')::integer, 2, '재정렬 후 버전 2');
end;
$do$;

select tests_support.ok(
  tests_support.try_sqlstate('set constraints all immediate') is null,
  '사진 재정렬의 지연 집합 트리거가 로그인 역할에서 정상 실행된다');
set constraints all deferred;

reset role;
select tests_support.eq(
  (select string_agg(p.asset_id::text, ',' order by p.sort_order)
     from public.memory_photos p where p.memory_id = tests_support.get('memory_id')::uuid),
  tests_support.get('asset3') || ',' || tests_support.get('asset2') || ',' || tests_support.get('asset1'),
  '재정렬된 순서가 실제로 저장된다');

-- ---------------------------------------------------------------------------
-- 4) 지연 트리거의 거부 경로 (소유자 직접 DML로만 도달할 수 있다)
-- ---------------------------------------------------------------------------
-- RPC는 진입 단계에서 먼저 막기 때문에 로그인 역할로는 이 경로에 도달할 수 없다.
-- 트리거 자체가 여전히 위반을 잡는지 소유자 컨텍스트에서 확인한다.
do $do$
declare
  v_third uuid := gen_random_uuid();
  v_state text;
begin
  perform tests_support.make_user(v_third, 'third@test.invalid');
  perform tests_support.make_profile(v_third, '세번째');
  begin
    insert into public.space_members (space_id, user_id)
    values (tests_support.get('space_id')::uuid, v_third);
    set constraints all immediate;
  exception when others then
    v_state := sqlstate;
  end;
  perform tests_support.eq(v_state, 'GF411', '정원 초과는 지연 트리거가 여전히 잡는다');
end;
$do$;

rollback;

\echo '60_deferred_triggers.sql 완료 (모든 변경 롤백)'
