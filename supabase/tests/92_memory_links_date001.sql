-- DATE-001 테스트 92 — 데이트 기록 연결(memory_links)의 권한·RLS·카디널리티·삭제 의미·충돌·중복 요청
--
-- 확인 대상
--   * 로그인 사용자는 전용 RPC만 실행할 수 있고, 테이블 직접 쓰기는 막힌다(42501)
--   * 조회는 자기 공간만. 외부 공간(C)·비로그인은 연결의 존재 여부도 알 수 없다
--   * 같은 공간만 연결한다(세 방향 복합 FK). 다른 공간의 원본은 NOT_FOUND다
--   * **완료(done)** 상태의 일정·위시만 연결된다. 상대방 개인 일정도 연결할 수 있고,
--     연결해도 일정의 소유자·상태·버전·내용은 바뀌지 않는다
--   * 한 추억에 연결 행은 하나(PK), 한 원본에는 여러 추억을 연결할 수 있다(UNIQUE 없음)
--   * 연결·해제는 추억 version을 1 올린다. 오래된 스냅샷의 저장·고정·삭제는 CONFLICT다
--   * 연결을 보내지 않는 save_memory·고정은 연결을 **보존**한다
--   * 연결된 추억이 있는 일정·위시는 삭제가 GF409(`has_memories`)로 거부된다
--   * 연결된 추억을 지우면 연결만 사라지고 원본 일정·위시는 남는다
--   * 같은 requestId 재전송은 한 번만 반영되고, 같은 키·다른 입력은 CONFLICT다
--   * 공간 삭제는 추억·일정·위시·연결을 함께 정리한다(원본 FK가 no action이어야 통과한다)
--
-- 합성 신원만 쓴다(.invalid). 파일 끝에서 ROLLBACK한다.
--
-- 한계: 한 세션 스크립트라 **동시 실행** 경쟁(연결 중 원본 삭제 등)은 재현하지 않는다.
--       잠금 설계(추억 FOR UPDATE → 원본 FOR KEY SHARE, 삭제는 원본 FOR UPDATE)와
--       E2E·동시성 시나리오로 확인한다. 파일 끝 주석 참고.

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\set ua 'd1111111-1111-4111-8111-111111111111'
\set ub 'd2222222-2222-4222-8222-222222222222'
\set uc 'd3333333-3333-4333-8333-333333333333'
\set s1 'dddddda1-dddd-4ddd-8ddd-ddddddddddd1'
\set s2 'dddddda2-dddd-4ddd-8ddd-ddddddddddd2'

\set e_done   'e0000001-0000-4000-8000-000000000001'
\set e_sched  'e0000002-0000-4000-8000-000000000002'
\set e_shared 'e0000003-0000-4000-8000-000000000003'
\set e_other  'e0000004-0000-4000-8000-000000000004'
\set w_done   'a0000001-0000-4000-8000-000000000001'
\set w_sched  'a0000002-0000-4000-8000-000000000002'
\set m1 'b0000001-0000-4000-8000-000000000001'
\set m2 'b0000002-0000-4000-8000-000000000002'
\set m3 'b0000003-0000-4000-8000-000000000003'
\set m_other 'b0000009-0000-4000-8000-000000000009'

select tests_support.make_user(:'ua', 'date92-a@test.invalid');
select tests_support.make_user(:'ub', 'date92-b@test.invalid');
select tests_support.make_user(:'uc', 'date92-c@test.invalid');
select tests_support.make_profile(:'ua', '에이');
select tests_support.make_profile(:'ub', '비이');
select tests_support.make_profile(:'uc', '씨이');
select tests_support.make_space(:'s1', :'ua', '기록 공간');
select tests_support.add_member(:'s1', :'ub');
select tests_support.make_space(:'s2', :'uc', '다른 공간');

-- 원본 픽스처(소유자 권한으로 직접 삽입한다. RPC 흐름 자체는 91·90번 테스트가 확인한다).
insert into public.wish_items (id, space_id, created_by, title, category, memo, status, planned_date)
values
  (:'w_done', :'s1', :'ub', '야시장 가기', 'activity', '', 'done', date '2026-03-03'),
  -- 완료하지 않은 위시. 아래 e_sched가 이 위시를 참조해 CAL-001의 삭제 거부를 회귀 확인한다.
  (:'w_sched', :'s1', :'ua', '캠핑 가기', 'trip', '', 'planned', null);

insert into public.calendar_events (
  id, space_id, created_by, owner_id, kind, title, location, note,
  starts_at, ends_at, all_day, status, wish_item_id)
values
  -- A의 **개인** 완료 일정. B도 연결할 수 있어야 한다.
  (:'e_done', :'s1', :'ua', :'ua', 'personal', '전시 관람', '성수동', '',
   timestamptz '2026-03-05 10:00:00+09', timestamptz '2026-03-05 12:00:00+09', false, 'done', null),
  -- 아직 완료하지 않은 일정. w_sched를 참조한다.
  (:'e_sched', :'s1', :'ua', null, 'date', '아직 예정', null, '',
   timestamptz '2026-03-09 19:00:00+09', null, false, 'scheduled', :'w_sched'),
  -- 공동 완료 일정(종일, 포함 종료일).
  (:'e_shared', :'s1', :'ub', null, 'date', '바다 여행', '강릉', '',
   timestamptz '2026-03-01 00:00:00+09', timestamptz '2026-03-02 00:00:00+09', true, 'done', null),
  -- 다른 공간의 완료 일정.
  (:'e_other', :'s2', :'uc', null, 'date', '외부 일정', null, '',
   timestamptz '2026-03-05 10:00:00+09', null, false, 'done', null);

select tests_support.make_memory(:'m1', :'s1', :'ua', '전시 다녀온 날');
select tests_support.make_memory(:'m2', :'s1', :'ub', '같은 전시 다른 기록');
select tests_support.make_memory(:'m3', :'s1', :'ua', '야시장 기록');
select tests_support.make_memory(:'m_other', :'s2', :'uc', '외부 기록');

-- ---------------------------------------------------------------------------
-- 권한·스키마 (역할 전환 전에 카탈로그로 확인한다)
-- ---------------------------------------------------------------------------
select tests_support.ok(
  has_function_privilege('authenticated',
    'public.link_memory_plan(uuid,text,uuid,integer,uuid)', 'EXECUTE'),
  'authenticated는 link_memory_plan을 실행할 수 있다');
select tests_support.ok(
  has_function_privilege('authenticated',
    'public.unlink_memory_plan(uuid,integer,uuid)', 'EXECUTE'),
  'authenticated는 unlink_memory_plan을 실행할 수 있다');
select tests_support.ok(
  not has_function_privilege('anon', 'public.link_memory_plan(uuid,text,uuid,integer,uuid)', 'EXECUTE'),
  'anon은 link_memory_plan을 실행할 수 없다');
select tests_support.ok(
  not has_function_privilege('anon', 'public.unlink_memory_plan(uuid,integer,uuid)', 'EXECUTE'),
  'anon은 unlink_memory_plan을 실행할 수 없다');
select tests_support.ok(
  not has_function_privilege('authenticated',
    'app_private.memory_link_lock_source(uuid,text,uuid)', 'EXECUTE'),
  '내부 원본 잠금 헬퍼는 로그인 사용자에게 노출되지 않는다');

select tests_support.ok(
  not exists (
    select 1 from information_schema.role_table_grants g
     where g.table_schema = 'public' and g.table_name = 'memory_links'
       and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
       and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  'memory_links에는 클라이언트·서비스 역할의 직접 쓰기 권한이 없다');

select tests_support.ok(
  (select c.relrowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'memory_links'),
  'memory_links에 RLS가 켜져 있다');

-- 세 관계 모두 (id, space_id) 복합 FK여야 같은 공간만 연결된다.
select tests_support.eq(
  (select count(*)::integer from pg_constraint c
    where c.conrelid = 'public.memory_links'::regclass
      and c.contype = 'f'
      and c.conname in ('memory_links_memory_same_space',
                        'memory_links_event_same_space',
                        'memory_links_wish_same_space')
      and array_length(c.conkey, 1) = 2),
  3,
  '추억·일정·위시 세 방향 모두 (id, space_id) 복합 FK다');

select tests_support.eq(
  (select c.confdeltype from pg_constraint c
    where c.conrelid = 'public.memory_links'::regclass
      and c.conname = 'memory_links_memory_same_space'),
  'c'::"char",
  '추억 삭제는 연결을 cascade로 정리한다');

select tests_support.eq(
  (select count(*)::integer from pg_constraint c
    where c.conrelid = 'public.memory_links'::regclass
      and c.conname in ('memory_links_event_same_space', 'memory_links_wish_same_space')
      and c.confdeltype = 'a'),
  2,
  '원본(일정·위시) FK는 no action이다(공간 cascade를 막지 않는다)');

select tests_support.ok(
  not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.memory_links'::regclass
       and c.contype = 'u'),
  '원본 ID에 UNIQUE 제약이 없다(한 원본에 여러 추억을 연결할 수 있다)');

-- ---------------------------------------------------------------------------
-- A: 연결 생성, 버전 증가, 카디널리티
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

-- 테이블 직접 쓰기는 권한에서 막힌다(정책 이전 단계).
select tests_support.expect_error(
  format('insert into public.memory_links (memory_id, space_id, source, calendar_event_id, linked_by)
          values (%L, %L, ''event'', %L, %L)', :'m1', :'s1', :'e_done', :'ua'),
  '42501', '로그인 사용자는 memory_links에 직접 INSERT할 수 없다');
select tests_support.expect_error(
  format('update public.memory_links set source = ''wish'' where memory_id = %L', :'m1'),
  '42501', '로그인 사용자는 memory_links를 직접 UPDATE할 수 없다');
select tests_support.expect_error(
  format('delete from public.memory_links where memory_id = %L', :'m1'),
  '42501', '로그인 사용자는 memory_links를 직접 DELETE할 수 없다');

do $do$
declare
  v_memory  uuid := 'b0000001-0000-4000-8000-000000000001';
  v_event   uuid := 'e0000001-0000-4000-8000-000000000001';
  v_result  jsonb;
  v_before  integer;
  v_row     public.calendar_events%rowtype;
begin
  select m.version into v_before from public.memories m where m.id = v_memory;
  perform tests_support.eq(v_before, 1, '새 추억의 버전은 1이다');

  select * into v_row from public.calendar_events e where e.id = v_event;

  -- A는 자기 개인 일정에 연결한다.
  v_result := public.link_memory_plan(v_memory, 'event', v_event, v_before, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'source', 'event', '일정 원본으로 연결된다');
  perform tests_support.eq((v_result ->> 'eventId')::uuid, v_event, '연결한 일정 ID를 돌려준다');
  perform tests_support.eq(v_result ->> 'wishId', null, '일정 연결에는 위시 ID가 없다');
  perform tests_support.eq((v_result ->> 'version')::integer, v_before + 1,
    '연결하면 추억 version이 1 오른다');
  perform tests_support.eq((v_result ->> 'replacedPreviousLink')::boolean, false,
    '첫 연결은 교체가 아니다');

  -- 원본 일정은 어떤 열도 바뀌지 않는다.
  perform tests_support.eq(
    (select e.version from public.calendar_events e where e.id = v_event), v_row.version,
    '연결해도 일정 version은 그대로다');
  perform tests_support.eq(
    (select e.status from public.calendar_events e where e.id = v_event), v_row.status,
    '연결해도 일정 상태는 그대로다');
  perform tests_support.eq(
    (select e.owner_id from public.calendar_events e where e.id = v_event), v_row.owner_id,
    '연결해도 일정 소유자는 그대로다');
  perform tests_support.eq(
    (select e.updated_at from public.calendar_events e where e.id = v_event), v_row.updated_at,
    '연결해도 일정 updated_at은 그대로다');
end;
$do$;

-- 같은 원본을 다시 연결해도 아무것도 바뀌지 않는다(버전도 오르지 않는다).
do $do$
declare
  v_memory uuid := 'b0000001-0000-4000-8000-000000000001';
  v_event  uuid := 'e0000001-0000-4000-8000-000000000001';
  v_result jsonb;
begin
  v_result := public.link_memory_plan(v_memory, 'event', v_event, 2, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, 2,
    '같은 원본 재연결은 version을 올리지 않는다');
  perform tests_support.eq((v_result ->> 'alreadyLinked')::boolean, true,
    '같은 원본 재연결은 alreadyLinked로 알린다');
  perform tests_support.eq(
    (select count(*)::integer from public.memory_links l where l.memory_id = v_memory), 1,
    '추억당 연결 행은 하나다');
end;
$do$;

-- 완료하지 않은 원본은 연결할 수 없다.
select tests_support.expect_error(
  format('select public.link_memory_plan(%L, ''event'', %L, 2, gen_random_uuid())', :'m2', :'e_sched'),
  'GF409', '예정 상태 일정은 연결할 수 없다');
select tests_support.expect_error(
  format('select public.link_memory_plan(%L, ''wish'', %L, 1, gen_random_uuid())', :'m2', :'w_sched'),
  'GF409', '완료하지 않은 위시는 연결할 수 없다');

-- 다른 공간의 원본·추억은 존재 여부를 알리지 않는다.
select tests_support.expect_error(
  format('select public.link_memory_plan(%L, ''event'', %L, 1, gen_random_uuid())', :'m2', :'e_other'),
  'GF404', '다른 공간의 일정은 연결할 수 없다(존재를 알리지 않는다)');
select tests_support.expect_error(
  format('select public.link_memory_plan(%L, ''event'', %L, 1, gen_random_uuid())', :'m_other', :'e_done'),
  'GF404', '다른 공간의 추억에는 연결할 수 없다');

-- 알 수 없는 원본 종류는 검증 오류다.
select tests_support.expect_error(
  format('select public.link_memory_plan(%L, ''restaurant'', %L, 1, gen_random_uuid())', :'m2', :'e_done'),
  'GF422', '허용하지 않는 source 값은 거부한다');
select tests_support.expect_error(
  format('select public.link_memory_plan(%L, ''event'', null, 1, gen_random_uuid())', :'m2'),
  'GF422', 'sourceId 없는 연결은 거부한다');

-- 오래된 버전으로는 연결하지 못한다.
select tests_support.expect_error(
  format('select public.link_memory_plan(%L, ''wish'', %L, 1, gen_random_uuid())', :'m1', :'w_done'),
  'GF409', '오래된 추억 버전으로는 연결을 바꿀 수 없다');

-- 한 원본에 **여러 추억**을 연결할 수 있다(UNIQUE 없음).
do $do$
declare
  v_result jsonb;
begin
  v_result := public.link_memory_plan(
    'b0000002-0000-4000-8000-000000000002', 'event',
    'e0000001-0000-4000-8000-000000000001', 1, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, 2, '두 번째 추억도 연결된다');
  perform tests_support.eq(
    (select count(*)::integer from public.memory_links l
      where l.calendar_event_id = 'e0000001-0000-4000-8000-000000000001'),
    2,
    '한 일정에 두 추억을 연결할 수 있다');
end;
$do$;

-- 위시 연결과 원본 교체(명시적·버전 증가).
do $do$
declare
  v_memory uuid := 'b0000003-0000-4000-8000-000000000003';
  v_result jsonb;
begin
  v_result := public.link_memory_plan(
    v_memory, 'wish', 'a0000001-0000-4000-8000-000000000001', 1, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'source', 'wish', '위시 원본으로 연결된다');
  perform tests_support.eq(v_result ->> 'eventId', null, '위시 연결에는 일정 ID가 없다');
  perform tests_support.eq((v_result ->> 'version')::integer, 2, '위시 연결도 version을 올린다');

  -- 원본 교체는 새 요청으로 명시한다. 조용히 두 원본을 함께 갖지 않는다.
  v_result := public.link_memory_plan(
    v_memory, 'event', 'e0000003-0000-4000-8000-000000000003', 2, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'replacedPreviousLink')::boolean, true,
    '원본 교체는 replacedPreviousLink로 알린다');
  perform tests_support.eq((v_result ->> 'version')::integer, 3, '교체도 version을 올린다');
  perform tests_support.eq(
    (select l.wish_item_id from public.memory_links l where l.memory_id = v_memory), null,
    '교체 뒤에는 이전 위시 ID가 남지 않는다');
  perform tests_support.eq(
    (select l.calendar_event_id from public.memory_links l where l.memory_id = v_memory),
    'e0000003-0000-4000-8000-000000000003'::uuid,
    '교체 뒤에는 새 일정 ID만 남는다');
  perform tests_support.eq(
    (select count(*)::integer from public.memory_links l where l.memory_id = v_memory), 1,
    '교체해도 연결 행은 하나다');
end;
$do$;

-- ---------------------------------------------------------------------------
-- 중복 요청(멱등성)
-- ---------------------------------------------------------------------------
do $do$
declare
  v_memory  uuid := 'b0000003-0000-4000-8000-000000000003';
  v_request uuid := gen_random_uuid();
  v_first   jsonb;
  v_second  jsonb;
begin
  -- m3를 다시 위시로 되돌린다(버전 3 → 4).
  v_first := public.link_memory_plan(
    v_memory, 'wish', 'a0000001-0000-4000-8000-000000000001', 3, v_request);
  v_second := public.link_memory_plan(
    v_memory, 'wish', 'a0000001-0000-4000-8000-000000000001', 3, v_request);
  perform tests_support.eq(v_second, v_first, '같은 requestId 재전송은 같은 결과를 돌려준다');
  perform tests_support.eq(
    (select m.version from public.memories m where m.id = v_memory), 4,
    '재전송이 version을 두 번 올리지 않는다');
end;
$do$;

do $do$
declare
  v_request uuid := gen_random_uuid();
begin
  perform public.link_memory_plan(
    'b0000002-0000-4000-8000-000000000002', 'event',
    'e0000001-0000-4000-8000-000000000001', 2, v_request);
  -- 같은 키에 다른 입력은 거부한다.
  begin
    perform public.link_memory_plan(
      'b0000002-0000-4000-8000-000000000002', 'event',
      'e0000003-0000-4000-8000-000000000003', 2, v_request);
    perform tests_support.ok(false, '같은 requestId·다른 입력이 거부되지 않았다');
  exception when sqlstate 'GF409' then
    perform tests_support.ok(true, '같은 requestId에 다른 입력은 CONFLICT다');
  end;
end;
$do$;

-- ---------------------------------------------------------------------------
-- 기존 추억 흐름이 연결을 보존한다
-- ---------------------------------------------------------------------------
do $do$
declare
  v_memory uuid := 'b0000001-0000-4000-8000-000000000001';
  v_result jsonb;
begin
  -- save_memory(본문 수정)는 연결을 건드리지 않는다.
  v_result := public.save_memory(
    v_memory, '전시 다녀온 날(수정)', '본문을 고쳤다', current_date - 1, '성수동',
    '{}'::text[], '{}'::uuid[], false, 2, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, 3, '수정은 version을 올린다');
  perform tests_support.eq(
    (select l.calendar_event_id from public.memory_links l where l.memory_id = v_memory),
    'e0000001-0000-4000-8000-000000000001'::uuid,
    '본문 수정이 연결을 지우지 않는다');

  -- 홈 고정도 같은 save_memory를 쓴다. 연결은 그대로다.
  v_result := public.save_memory(
    v_memory, '전시 다녀온 날(수정)', '본문을 고쳤다', current_date - 1, '성수동',
    '{}'::text[], '{}'::uuid[], true, 3, gen_random_uuid());
  perform tests_support.eq(
    (select count(*)::integer from public.memory_links l where l.memory_id = v_memory), 1,
    '홈 고정이 연결을 지우지 않는다');
end;
$do$;

-- 연결 뒤 오래된 스냅샷으로 저장하면 충돌한다(조용한 덮어쓰기 방지).
select tests_support.expect_error(
  format('select public.save_memory(%L, ''낡은 스냅샷'', '''', current_date - 1, null,
          ''{}''::text[], ''{}''::uuid[], false, 1, gen_random_uuid())', :'m3'),
  'GF409', '연결로 version이 오른 뒤 낡은 스냅샷 저장은 CONFLICT다');

-- ---------------------------------------------------------------------------
-- B(상대 구성원): 상대의 개인 일정에도 연결할 수 있고, 일정은 바뀌지 않는다
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);

do $do$
declare
  v_memory uuid := 'b0000002-0000-4000-8000-000000000002';
  v_event  uuid := 'e0000001-0000-4000-8000-000000000001';
  v_before public.calendar_events%rowtype;
  v_result jsonb;
begin
  select * into v_before from public.calendar_events e where e.id = v_event;
  perform tests_support.eq(v_before.owner_id, 'd1111111-1111-4111-8111-111111111111'::uuid,
    '대상은 A의 개인 일정이다');

  -- B는 그 일정을 **수정할 수 없지만**(CAL-001), 연결은 바꿀 수 있다.
  v_result := public.link_memory_plan(
    v_memory, 'event', 'e0000003-0000-4000-8000-000000000003', 2, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, 3,
    'B도 공유 추억의 연결을 바꿀 수 있다');

  v_result := public.link_memory_plan(v_memory, 'event', v_event, 3, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'eventId')::uuid, v_event,
    'B는 상대의 개인 일정에도 연결할 수 있다(조회 권한과 같다)');
  perform tests_support.eq(
    (select l.linked_by from public.memory_links l where l.memory_id = v_memory),
    'd2222222-2222-4222-8222-222222222222'::uuid,
    '마지막으로 연결을 바꾼 사람이 기록된다');

  -- 일정 자체는 여전히 A의 것이고 아무것도 바뀌지 않았다.
  perform tests_support.eq(
    (select e.version from public.calendar_events e where e.id = v_event), v_before.version,
    'B의 연결이 A의 개인 일정 version을 바꾸지 않는다');
  perform tests_support.eq(
    (select e.owner_id from public.calendar_events e where e.id = v_event), v_before.owner_id,
    'B의 연결이 A의 개인 일정 소유자를 바꾸지 않는다');
end;
$do$;

-- B가 A의 개인 일정을 직접 바꾸는 것은 여전히 막힌다(CAL-001 계약 회귀).
select tests_support.expect_error(
  format('select public.set_calendar_event_status(%L, ''scheduled'', 1, gen_random_uuid())', :'e_done'),
  'GF403', 'B는 A의 개인 일정 상태를 바꿀 수 없다(연결 권한과 다르다)');

-- ---------------------------------------------------------------------------
-- 원본 삭제 거부 (GF409 has_memories)
-- ---------------------------------------------------------------------------
-- A의 개인 일정이므로 삭제 권한이 있는 A로 돌아가 확인한다.
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);

do $do$
declare
  v_event   uuid := 'e0000001-0000-4000-8000-000000000001';
  v_version integer;
  v_state   text;
  v_detail  text;
begin
  select e.version into v_version from public.calendar_events e where e.id = v_event;
  begin
    perform public.delete_calendar_event(v_event, v_version, gen_random_uuid());
    perform tests_support.ok(false, '연결된 추억이 있는 일정이 삭제됐다');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    perform tests_support.eq(v_state, 'GF409', '연결된 추억이 있는 일정 삭제는 GF409다');
    perform tests_support.eq(v_detail, '{"eventId":"has_memories"}',
      '삭제 거부의 DETAIL이 eventId:has_memories다');
  end;
  perform tests_support.ok(
    exists (select 1 from public.calendar_events e where e.id = v_event),
    '거부된 삭제는 일정을 남긴다');
end;
$do$;

do $do$
declare
  v_wish    uuid := 'a0000001-0000-4000-8000-000000000001';
  v_version integer;
  v_state   text;
  v_detail  text;
begin
  select w.version into v_version from public.wish_items w where w.id = v_wish;
  begin
    perform public.delete_wish(v_wish, v_version, gen_random_uuid());
    perform tests_support.ok(false, '연결된 추억이 있는 위시가 삭제됐다');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    perform tests_support.eq(v_state, 'GF409', '연결된 추억이 있는 위시 삭제는 GF409다');
    perform tests_support.eq(v_detail, '{"wishId":"has_memories"}',
      '삭제 거부의 DETAIL이 wishId:has_memories다');
  end;
  perform tests_support.ok(
    exists (select 1 from public.wish_items w where w.id = v_wish),
    '거부된 삭제는 위시를 남긴다');
end;
$do$;

-- 일정이 연결된 위시의 기존 거부(CAL-001)는 그대로 남아 있다.
do $do$
declare
  v_wish    uuid := 'a0000002-0000-4000-8000-000000000002';
  v_version integer;
  v_state   text;
  v_detail  text;
begin
  -- 픽스처에서 e_sched가 이미 이 위시를 참조한다(위시 상태는 planned 그대로).
  perform tests_support.ok(
    exists (select 1 from public.calendar_events e where e.wish_item_id = v_wish),
    '이 위시를 참조하는 일정이 있다');

  select w.version into v_version from public.wish_items w where w.id = v_wish;
  begin
    perform public.delete_wish(v_wish, v_version, gen_random_uuid());
    perform tests_support.ok(false, '연결된 일정이 있는 위시가 삭제됐다');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    perform tests_support.eq(v_state, 'GF409', '연결된 일정이 있는 위시 삭제는 여전히 GF409다');
    perform tests_support.eq(v_detail, '{"wishId":"has_calendar_events"}',
      'CAL-001의 has_calendar_events 힌트가 유지된다');
  end;
end;
$do$;

-- ---------------------------------------------------------------------------
-- 추억 삭제: 연결만 사라지고 원본은 남는다
-- ---------------------------------------------------------------------------
do $do$
declare
  v_memory uuid := 'b0000003-0000-4000-8000-000000000003';
  v_wish   uuid := 'a0000001-0000-4000-8000-000000000001';
  v_version integer;
begin
  perform tests_support.eq(
    (select l.wish_item_id from public.memory_links l where l.memory_id = v_memory), v_wish,
    '삭제 전 추억은 위시와 연결돼 있다');

  select m.version into v_version from public.memories m where m.id = v_memory;
  perform public.delete_memory(v_memory, v_version, gen_random_uuid());

  perform tests_support.eq(
    (select count(*)::integer from public.memory_links l where l.memory_id = v_memory), 0,
    '추억을 지우면 연결도 사라진다');
  perform tests_support.ok(
    exists (select 1 from public.wish_items w where w.id = v_wish),
    '추억을 지워도 원본 위시는 남는다');
  perform tests_support.eq(
    (select w.status from public.wish_items w where w.id = v_wish), 'done',
    '추억을 지워도 위시 상태는 그대로다');
end;
$do$;

-- 연결이 모두 사라진 뒤에는 원본을 지울 수 있다.
do $do$
declare
  v_wish    uuid := 'a0000001-0000-4000-8000-000000000001';
  v_version integer;
begin
  select w.version into v_version from public.wish_items w where w.id = v_wish;
  perform public.delete_wish(v_wish, v_version, gen_random_uuid());
  perform tests_support.ok(
    not exists (select 1 from public.wish_items w where w.id = v_wish),
    '연결된 추억이 없어지면 위시를 지울 수 있다');
end;
$do$;

-- ---------------------------------------------------------------------------
-- 연결 해제 (명시적)
-- ---------------------------------------------------------------------------
do $do$
declare
  v_memory  uuid := 'b0000001-0000-4000-8000-000000000001';
  v_version integer;
  v_result  jsonb;
begin
  select m.version into v_version from public.memories m where m.id = v_memory;
  v_result := public.unlink_memory_plan(v_memory, v_version, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, v_version + 1,
    '연결 해제도 version을 올린다');
  perform tests_support.eq(v_result ->> 'source', 'event', '무엇을 해제했는지 돌려준다');
  perform tests_support.eq(
    (select count(*)::integer from public.memory_links l where l.memory_id = v_memory), 0,
    '해제하면 연결 행이 사라진다');
  perform tests_support.ok(
    exists (select 1 from public.calendar_events e
             where e.id = 'e0000001-0000-4000-8000-000000000001'),
    '해제해도 원본 일정은 남는다');
end;
$do$;

-- 연결이 없는데 해제하면 NOT_FOUND다(무엇을 했는지 모른 채 성공이라고 하지 않는다).
do $do$
declare
  v_memory  uuid := 'b0000001-0000-4000-8000-000000000001';
  v_version integer;
begin
  select m.version into v_version from public.memories m where m.id = v_memory;
  begin
    perform public.unlink_memory_plan(v_memory, v_version, gen_random_uuid());
    perform tests_support.ok(false, '연결이 없는데 해제가 성공했다');
  exception when sqlstate 'GF404' then
    perform tests_support.ok(true, '연결이 없으면 해제는 NOT_FOUND다');
  end;
end;
$do$;

-- 오래된 버전으로는 해제할 수 없다.
select tests_support.expect_error(
  format('select public.unlink_memory_plan(%L, 1, gen_random_uuid())', :'m2'),
  'GF409', '오래된 버전으로는 연결을 해제할 수 없다');

-- 연결된 추억이 남아 있는 일정은 여전히 삭제할 수 없다(m2가 e_done에 연결돼 있다).
select tests_support.expect_error(
  format('select public.delete_calendar_event(%L, (select version from public.calendar_events where id = %L), gen_random_uuid())',
         :'e_done', :'e_done'),
  'GF409', '다른 추억이 아직 연결돼 있으면 일정 삭제는 계속 거부된다');

-- ---------------------------------------------------------------------------
-- C(외부 공간)와 비로그인: 존재 여부도 알 수 없다
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'uc'), true);
select set_config('request.jwt.claim.sub', :'uc', true);

select tests_support.expect_no_rows(
  'select * from public.memory_links',
  '외부 공간 계정에는 연결이 하나도 보이지 않는다');

select tests_support.expect_error(
  format('select public.link_memory_plan(%L, ''event'', %L, 1, gen_random_uuid())', :'m2', :'e_done'),
  'GF404', '외부 공간 계정은 남의 추억을 연결할 수 없다');
select tests_support.expect_error(
  format('select public.unlink_memory_plan(%L, 3, gen_random_uuid())', :'m2'),
  'GF404', '외부 공간 계정은 남의 연결을 해제할 수 없다');

reset role;
select set_config('request.jwt.claims', null, true);
select set_config('request.jwt.claim.sub', null, true);
set local role anon;

select tests_support.expect_no_rows(
  'select * from public.memory_links',
  '비로그인에는 연결이 보이지 않는다');
select tests_support.expect_error(
  format('select public.link_memory_plan(%L, ''event'', %L, 1, gen_random_uuid())', :'m2', :'e_done'),
  '42501', '비로그인은 link_memory_plan을 실행할 수 없다');
select tests_support.expect_error(
  format('select public.unlink_memory_plan(%L, 1, gen_random_uuid())', :'m2'),
  '42501', '비로그인은 unlink_memory_plan을 실행할 수 없다');

reset role;

-- ---------------------------------------------------------------------------
-- 공간 삭제 cascade — 원본 FK가 no action이어야 통과한다
-- ---------------------------------------------------------------------------
-- 설계 결정 4의 전제를 **실제로 실행해** 확인한다(이 트랜잭션은 뒤에서 롤백된다).
do $do$
declare
  v_space uuid := 'dddddda1-dddd-4ddd-8ddd-ddddddddddd1';
begin
  perform tests_support.ok(
    exists (select 1 from public.memory_links l where l.space_id = v_space),
    'cascade 확인 전에 연결이 남아 있다');

  delete from public.spaces s where s.id = v_space;

  perform tests_support.eq(
    (select count(*)::integer from public.memory_links l where l.space_id = v_space), 0,
    '공간을 지우면 연결도 함께 사라진다');
  perform tests_support.eq(
    (select count(*)::integer from public.calendar_events e where e.space_id = v_space), 0,
    '공간을 지우면 일정도 함께 사라진다');
  perform tests_support.eq(
    (select count(*)::integer from public.memories m where m.space_id = v_space), 0,
    '공간을 지우면 추억도 함께 사라진다');
end;
$do$;

-- ---------------------------------------------------------------------------
-- 이 파일이 확인하지 못하는 것 (한 세션 한계)
-- ---------------------------------------------------------------------------
--   * 연결 삽입과 원본 삭제의 **동시** 직렬화: 연결은 원본에 FOR KEY SHARE를, 삭제 RPC는
--     FOR UPDATE를 잡아 서로를 기다린다. 두 세션이 필요해 여기서는 재현하지 않는다.
--   * 두 구성원이 같은 추억의 연결을 동시에 바꾸는 경쟁: 추억 행 FOR UPDATE로 직렬화되고
--     뒤선 쪽이 version 충돌을 본다. 브라우저 E2E와 동시성 시나리오로 확인한다.
--   * 잠금 순서(추억 → 원본)는 link/unlink 양쪽에서 같다. 삭제 RPC는 원본만 잡으므로
--     순환 대기가 생기지 않는다. 이 성질은 코드 검토와 동시 실행 시나리오로만 확인할 수 있다.

rollback;
