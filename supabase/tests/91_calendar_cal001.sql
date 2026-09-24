-- CAL-001 테스트 91 — 커플 캘린더(calendar_events)의 권한·검증·소유권·충돌·중복 요청·위시 연결
--
-- 확인 대상
--   * 로그인 사용자는 전용 RPC만 실행할 수 있고, 테이블 직접 쓰기는 막힌다
--   * 개인 일정(owner 있음)은 두 사람이 모두 보지만 **소유자만** 바꾼다(FORBIDDEN)
--   * 공동 데이트 일정(owner null)은 두 사람 모두 바꾸고 완료 체크한다
--   * 시각은 서버가 한국 시간으로 조립한다. 종일 일정은 KST 자정 정렬 + 포함 종료일이다
--   * 제목·장소·메모·종일/시간 조합 검증, 종료가 시작보다 앞이면 거부
--   * kind·owner는 생성 후 바꿀 수 없다
--   * 위시 연결은 같은 공간만. 연결된 일정이 있는 위시는 삭제가 CONFLICT로 거부된다
--   * 버전 충돌, 같은 requestId 재전송/다른 입력
--   * 외부 공간 구성원(C)·비로그인은 존재 여부를 알 수 없다
--
-- 합성 신원만 쓴다(.invalid). 파일 끝에서 ROLLBACK한다.

\set ON_ERROR_STOP on

begin;
\ir _helpers.sql

\set ua 'c1111111-1111-4111-8111-111111111111'
\set ub 'c2222222-2222-4222-8222-222222222222'
\set uc 'c3333333-3333-4333-8333-333333333333'
\set s1 'cccccca1-cccc-4ccc-8ccc-ccccccccccc1'
\set s2 'cccccca2-cccc-4ccc-8ccc-ccccccccccc2'

select tests_support.make_user(:'ua', 'cal91-a@test.invalid');
select tests_support.make_user(:'ub', 'cal91-b@test.invalid');
select tests_support.make_user(:'uc', 'cal91-c@test.invalid');
select tests_support.make_profile(:'ua', '에이');
select tests_support.make_profile(:'ub', '비이');
select tests_support.make_profile(:'uc', '씨이');
select tests_support.make_space(:'s1', :'ua', '캘린더 공간');
select tests_support.add_member(:'s1', :'ub');
select tests_support.make_space(:'s2', :'uc', '다른 공간');

-- ---------------------------------------------------------------------------
-- 권한 (역할 전환 전에 카탈로그로 확인한다)
-- ---------------------------------------------------------------------------
select tests_support.ok(
  has_function_privilege('authenticated',
    'public.save_calendar_event(uuid,text,text,text,text,boolean,date,time,date,time,uuid,integer,uuid)', 'EXECUTE'),
  'authenticated는 save_calendar_event를 실행할 수 있다');
select tests_support.ok(
  has_function_privilege('authenticated',
    'public.set_calendar_event_status(uuid,text,integer,uuid)', 'EXECUTE'),
  'authenticated는 set_calendar_event_status를 실행할 수 있다');
select tests_support.ok(
  has_function_privilege('authenticated', 'public.delete_calendar_event(uuid,integer,uuid)', 'EXECUTE'),
  'authenticated는 delete_calendar_event를 실행할 수 있다');

select tests_support.ok(
  not has_function_privilege('anon',
    'public.save_calendar_event(uuid,text,text,text,text,boolean,date,time,date,time,uuid,integer,uuid)', 'EXECUTE'),
  'anon은 save_calendar_event를 실행할 수 없다');
select tests_support.ok(
  not has_function_privilege('anon', 'public.set_calendar_event_status(uuid,text,integer,uuid)', 'EXECUTE'),
  'anon은 set_calendar_event_status를 실행할 수 없다');
select tests_support.ok(
  not has_function_privilege('anon', 'public.delete_calendar_event(uuid,integer,uuid)', 'EXECUTE'),
  'anon은 delete_calendar_event를 실행할 수 없다');

select tests_support.ok(
  not has_function_privilege('authenticated', 'app_private.kst_moment(date,time)', 'EXECUTE'),
  '내부 시각 조립 헬퍼는 로그인 사용자에게 노출되지 않는다');
select tests_support.ok(
  not has_function_privilege('authenticated', 'app_private.calendar_can_write(uuid,uuid)', 'EXECUTE'),
  '내부 권한 판단 헬퍼는 로그인 사용자에게 노출되지 않는다');

-- 소유자(postgres)는 마이그레이션·복구 경로다. 클라이언트·서비스 역할만 본다.
select tests_support.ok(
  not exists (
    select 1 from information_schema.role_table_grants g
     where g.table_schema = 'public' and g.table_name = 'calendar_events'
       and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
       and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  'calendar_events에는 클라이언트·서비스 역할의 직접 쓰기 권한이 없다');

select tests_support.ok(
  (select c.relrowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'calendar_events'),
  'calendar_events에 RLS가 켜져 있다');

-- 위시 연결은 같은 공간만 허용하는 복합 FK여야 한다.
select tests_support.ok(
  exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.calendar_events'::regclass
       and c.conname = 'calendar_events_wish_same_space'
       and c.contype = 'f'
       and c.confrelid = 'public.wish_items'::regclass
       and array_length(c.conkey, 1) = 2),
  'wish_item_id는 (id, space_id) 복합 FK로 같은 공간만 참조한다');

-- ---------------------------------------------------------------------------
-- A: 생성, 시각 조립, 입력 검증, 중복 요청
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare
  v_result jsonb;
  v_event  uuid;
begin
  -- 시간 일정: 한국 시간 기준 날짜+시각으로 조립된다
  v_result := public.save_calendar_event(
    null, 'personal', '치과 예약', '역삼역 2번 출구', '30분 전 도착',
    false, date '2026-11-07', time '14:30', null, time '15:30',
    null, 0, gen_random_uuid());
  v_event := (v_result ->> 'eventId')::uuid;
  perform tests_support.put('e_personal_a', v_event::text);
  perform tests_support.eq(v_result ->> 'kind', 'personal', '개인 일정으로 저장된다');
  perform tests_support.eq(v_result ->> 'status', 'scheduled', '새 일정은 scheduled다');
  perform tests_support.eq((v_result ->> 'version')::integer, 1, '새 일정은 버전 1');
  perform tests_support.eq(v_result ->> 'ownerId', 'c1111111-1111-4111-8111-111111111111',
    '응답의 소유자는 만든 사람이다');
end;
$do$;

-- 저장된 행으로 시각·장소·메모를 다시 확인한다
do $do$
declare
  v_event uuid := tests_support.get('e_personal_a')::uuid;
  v_row   public.calendar_events%rowtype;
begin
  select * into v_row from public.calendar_events e where e.id = v_event;
  perform tests_support.eq(v_row.owner_id, 'c1111111-1111-4111-8111-111111111111'::uuid,
    '개인 일정의 소유자는 만든 사람이다');
  perform tests_support.eq(v_row.created_by, 'c1111111-1111-4111-8111-111111111111'::uuid,
    '작성자가 기록된다');
  perform tests_support.eq((v_row.starts_at at time zone 'Asia/Seoul')::date, date '2026-11-07',
    '시작 날짜가 한국 시간 기준으로 저장된다');
  perform tests_support.eq((v_row.starts_at at time zone 'Asia/Seoul')::time, time '14:30',
    '시작 시각이 한국 시간 기준으로 저장된다');
  perform tests_support.eq((v_row.ends_at at time zone 'Asia/Seoul')::time, time '15:30',
    '종료 시각이 한국 시간 기준으로 저장된다');
  perform tests_support.eq(v_row.all_day, false, '시간 일정은 종일이 아니다');
  perform tests_support.eq(v_row.location, '역삼역 2번 출구', '장소가 저장된다');
  perform tests_support.eq(v_row.note, '30분 전 도착', '메모가 저장된다');
end;
$do$;

do $do$
declare
  v_result jsonb;
  v_req    uuid := gen_random_uuid();
  v_again  jsonb;
begin
  -- 같은 requestId·같은 입력 재전송은 같은 결과, 행은 하나
  v_result := public.save_calendar_event(
    null, 'date', '전시 보러 가기', null, '',
    false, date '2026-12-05', time '11:00', null, null,
    null, 0, v_req);
  perform tests_support.put('e_shared', v_result ->> 'eventId');
  perform tests_support.ok(v_result -> 'ownerId' = 'null'::jsonb, '공동 일정에는 소유자가 없다');
  perform tests_support.ok(v_result -> 'endsAt' = 'null'::jsonb, '종료는 선택이며 비워 둘 수 있다');

  v_again := public.save_calendar_event(
    null, 'date', '전시 보러 가기', null, '',
    false, date '2026-12-05', time '11:00', null, null,
    null, 0, v_req);
  perform tests_support.eq(v_again ->> 'eventId', v_result ->> 'eventId', '재전송은 같은 일정 ID');
  perform tests_support.eq(
    (select count(*)::integer from public.calendar_events e where e.title = '전시 보러 가기'),
    1, '재전송해도 일정은 한 건이다');

  -- 같은 requestId·다른 입력은 거부
  perform tests_support.expect_error(
    format($q$select public.save_calendar_event(null, 'date', '다른 제목', null, '', false,
                    date '2026-12-05', time '11:00', null, null, null, 0, %L)$q$, v_req),
    'GF409', '같은 requestId에 다른 입력은 CONFLICT');
end;
$do$;

-- 종일 일정: KST 자정 정렬, 포함 종료일
do $do$
declare
  v_result jsonb;
  v_row    public.calendar_events%rowtype;
begin
  v_result := public.save_calendar_event(
    null, 'date', '여행', '강릉', '',
    true, date '2026-10-03', null, date '2026-10-05', null,
    null, 0, gen_random_uuid());
  perform tests_support.put('e_allday', v_result ->> 'eventId');
  select * into v_row from public.calendar_events e where e.id = (v_result ->> 'eventId')::uuid;
  perform tests_support.eq(v_row.all_day, true, '종일 일정으로 저장된다');
  perform tests_support.eq((v_row.starts_at at time zone 'Asia/Seoul')::time, time '00:00',
    '종일 일정의 시작은 KST 자정이다');
  perform tests_support.eq((v_row.ends_at at time zone 'Asia/Seoul')::date, date '2026-10-05',
    '종일 일정의 종료일은 포함된다');
  perform tests_support.eq((v_row.ends_at at time zone 'Asia/Seoul')::time, time '00:00',
    '종일 일정의 종료도 KST 자정이다');

  -- 하루 종일 일정: 종료일을 보내지 않으면 시작일과 같다
  v_result := public.save_calendar_event(
    null, 'date', '하루 종일', null, '',
    true, date '2026-10-09', null, null, null,
    null, 0, gen_random_uuid());
  select * into v_row from public.calendar_events e where e.id = (v_result ->> 'eventId')::uuid;
  perform tests_support.eq((v_row.ends_at at time zone 'Asia/Seoul')::date, date '2026-10-09',
    '종료일을 비우면 하루 일정이 된다');
end;
$do$;

-- 입력 검증
do $do$
begin
  perform tests_support.expect_error(
    $q$select public.save_calendar_event(null, 'date', '  ', null, '', false,
             date '2026-11-07', time '10:00', null, null, null, 0, gen_random_uuid())$q$,
    'GF422', '빈 제목 거부');
  perform tests_support.expect_error(
    format($q$select public.save_calendar_event(null, 'date', %L, null, '', false,
             date '2026-11-07', time '10:00', null, null, null, 0, gen_random_uuid())$q$,
           repeat('가', 101)),
    'GF422', '101자 제목 거부');
  perform tests_support.expect_error(
    format($q$select public.save_calendar_event(null, 'date', '장소', %L, '', false,
             date '2026-11-07', time '10:00', null, null, null, 0, gen_random_uuid())$q$,
           repeat('가', 101)),
    'GF422', '101자 장소 거부');
  perform tests_support.expect_error(
    format($q$select public.save_calendar_event(null, 'date', '메모', null, %L, false,
             date '2026-11-07', time '10:00', null, null, null, 0, gen_random_uuid())$q$,
           repeat('가', 2001)),
    'GF422', '2001자 메모 거부');
  perform tests_support.expect_error(
    $q$select public.save_calendar_event(null, 'meeting', '분류', null, '', false,
             date '2026-11-07', time '10:00', null, null, null, 0, gen_random_uuid())$q$,
    'GF422', '허용되지 않은 kind 거부');
  perform tests_support.expect_error(
    $q$select public.save_calendar_event(null, 'date', '시작 없음', null, '', false,
             null, time '10:00', null, null, null, 0, gen_random_uuid())$q$,
    'GF422', '시작 날짜 없으면 거부');
  perform tests_support.expect_error(
    $q$select public.save_calendar_event(null, 'date', '시각 없음', null, '', false,
             date '2026-11-07', null, null, null, null, 0, gen_random_uuid())$q$,
    'GF422', '시간 일정에 시작 시각이 없으면 거부');
  perform tests_support.expect_error(
    $q$select public.save_calendar_event(null, 'date', '종일에 시각', null, '', true,
             date '2026-11-07', time '10:00', null, null, null, 0, gen_random_uuid())$q$,
    'GF422', '종일 일정에 시각을 주면 거부');
  perform tests_support.expect_error(
    $q$select public.save_calendar_event(null, 'date', '종일 역순', null, '', true,
             date '2026-11-07', null, date '2026-11-06', null, null, 0, gen_random_uuid())$q$,
    'GF422', '종일 일정의 종료일이 시작보다 앞이면 거부');
  perform tests_support.expect_error(
    $q$select public.save_calendar_event(null, 'date', '역순', null, '', false,
             date '2026-11-07', time '10:00', date '2026-11-07', time '09:00', null, 0, gen_random_uuid())$q$,
    'GF422', '종료가 시작보다 앞이면 거부');
  perform tests_support.expect_error(
    $q$select public.save_calendar_event(null, 'date', '같은 시각', null, '', false,
             date '2026-11-07', time '10:00', date '2026-11-07', time '10:00', null, 0, gen_random_uuid())$q$,
    'GF422', '시간 일정의 종료가 시작과 같으면 거부');
  perform tests_support.expect_error(
    $q$select public.save_calendar_event(null, 'date', '종료일만', null, '', false,
             date '2026-11-07', time '10:00', date '2026-11-08', null, null, 0, gen_random_uuid())$q$,
    'GF422', '종료 날짜만 보내면 거부');
  perform tests_support.expect_error(
    $q$select public.save_calendar_event(null, 'date', '버전', null, '', false,
             date '2026-11-07', time '10:00', null, null, null, 3, gen_random_uuid())$q$,
    'GF422', '생성인데 expectedVersion이 0이 아니면 거부');
end;
$do$;

-- 자정을 넘기는 시간 일정은 정상이다
do $do$
declare
  v_result jsonb;
  v_row    public.calendar_events%rowtype;
begin
  v_result := public.save_calendar_event(
    null, 'date', '밤새 영화', null, '',
    false, date '2026-11-07', time '23:00', date '2026-11-08', time '01:30',
    null, 0, gen_random_uuid());
  select * into v_row from public.calendar_events e where e.id = (v_result ->> 'eventId')::uuid;
  perform tests_support.eq((v_row.ends_at at time zone 'Asia/Seoul')::date, date '2026-11-08',
    '자정을 넘기는 일정의 종료일이 다음 날이 된다');
  perform tests_support.put('e_overnight', v_result ->> 'eventId');
end;
$do$;

-- ---------------------------------------------------------------------------
-- A: 수정·상태·kind 불변
-- ---------------------------------------------------------------------------
do $do$
declare
  v_event  uuid := tests_support.get('e_personal_a')::uuid;
  v_result jsonb;
begin
  -- kind는 생성 후 바꿀 수 없다
  perform tests_support.expect_error(
    format($q$select public.save_calendar_event(%L, 'date', '치과 예약', null, '', false,
             date '2026-11-07', time '14:30', null, null, null, 1, gen_random_uuid())$q$, v_event),
    'GF422', '개인 일정을 공동 일정으로 바꿀 수 없다');

  -- 내용 수정
  v_result := public.save_calendar_event(
    v_event, 'personal', '치과 예약(변경)', null, '스케일링',
    false, date '2026-11-08', time '10:00', null, null,
    null, 1, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, 2, '수정이 버전을 올린다');
  perform tests_support.eq(
    (select e.location from public.calendar_events e where e.id = v_event),
    null::text, '장소를 비우면 null이 된다');

  -- 버전 충돌
  perform tests_support.expect_error(
    format($q$select public.save_calendar_event(%L, 'personal', '다시', null, '', false,
             date '2026-11-08', time '10:00', null, null, null, 1, gen_random_uuid())$q$, v_event),
    'GF409', '낡은 expectedVersion은 CONFLICT');

  -- 상태 전이
  perform tests_support.expect_error(
    format($q$select public.set_calendar_event_status(%L, 'archived', 2, gen_random_uuid())$q$, v_event),
    'GF422', '허용되지 않은 상태 거부');
  v_result := public.set_calendar_event_status(v_event, 'done', 2, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'status', 'done', '완료 체크');
  perform tests_support.eq((v_result ->> 'version')::integer, 3, '상태 변경이 버전을 올린다');
  v_result := public.set_calendar_event_status(v_event, 'cancelled', 3, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'status', 'cancelled', '취소로 전환');
  v_result := public.set_calendar_event_status(v_event, 'scheduled', 4, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'status', 'scheduled', '예정으로 되돌리기');
  perform tests_support.expect_error(
    format($q$select public.set_calendar_event_status(%L, 'done', 4, gen_random_uuid())$q$, v_event),
    'GF409', '낡은 버전의 상태 변경은 CONFLICT');
end;
$do$;

-- ---------------------------------------------------------------------------
-- A: 위시 연결과 위시 삭제 의미
-- ---------------------------------------------------------------------------
do $do$
declare
  v_wish   uuid;
  v_other  uuid;
  v_result jsonb;
  v_event  uuid;
begin
  v_result := public.save_wish(null, '벚꽃 보러 가기', 'activity', '', null, 0, gen_random_uuid());
  v_wish := (v_result ->> 'wishId')::uuid;
  perform tests_support.put('w_linked', v_wish::text);

  -- 같은 공간의 위시는 연결된다
  v_result := public.save_calendar_event(
    null, 'date', '벚꽃 데이트', '여의도', '',
    true, date '2027-04-04', null, null, null,
    v_wish, 0, gen_random_uuid());
  v_event := (v_result ->> 'eventId')::uuid;
  perform tests_support.put('e_linked', v_event::text);
  perform tests_support.eq(v_result ->> 'wishItemId', v_wish::text, '위시가 연결된다');

  -- 다른 공간의 위시 ID는 존재 여부를 알리지 않는다
  perform tests_support.expect_error(
    format($q$select public.save_calendar_event(null, 'date', '가로채기', null, '', true,
             date '2027-04-05', null, null, null, %L, 0, gen_random_uuid())$q$, gen_random_uuid()),
    'GF404', '없는 위시 연결은 NOT_FOUND');

  -- 연결된 일정이 있는 위시는 삭제되지 않는다(CONFLICT, 확정 거부)
  perform tests_support.expect_error(
    format($q$select public.delete_wish(%L, 1, gen_random_uuid())$q$, v_wish),
    'GF409', '연결된 일정이 있는 위시 삭제는 CONFLICT');
  perform tests_support.eq(
    (select count(*)::integer from public.wish_items w where w.id = v_wish),
    1, '거부된 위시 삭제는 행을 남긴다');

  -- 연결을 끊으면 위시를 지울 수 있다
  v_result := public.save_calendar_event(
    v_event, 'date', '벚꽃 데이트', '여의도', '',
    true, date '2027-04-04', null, null, null,
    null, 1, gen_random_uuid());
  perform tests_support.ok(v_result -> 'wishItemId' = 'null'::jsonb, '연결을 해제할 수 있다');
  v_result := public.delete_wish(v_wish, 1, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'wishId', v_wish::text, '연결이 없으면 위시를 지울 수 있다');
end;
$do$;

-- ---------------------------------------------------------------------------
-- A: 테이블 직접 쓰기 차단
-- ---------------------------------------------------------------------------
do $do$
declare
  v_event uuid := tests_support.get('e_shared')::uuid;
begin
  perform tests_support.expect_error(
    format($q$insert into public.calendar_events (space_id, created_by, kind, title, starts_at)
              values (%L, %L, 'date', '직접 삽입', now())$q$,
           'cccccca1-cccc-4ccc-8ccc-ccccccccccc1', 'c1111111-1111-4111-8111-111111111111'),
    '42501', '로그인 사용자는 calendar_events에 직접 INSERT할 수 없다');
  perform tests_support.expect_error(
    format($q$update public.calendar_events set title = '직접 수정' where id = %L$q$, v_event),
    '42501', '로그인 사용자는 calendar_events를 직접 UPDATE할 수 없다');
  perform tests_support.expect_error(
    format($q$delete from public.calendar_events where id = %L$q$, v_event),
    '42501', '로그인 사용자는 calendar_events를 직접 DELETE할 수 없다');
end;
$do$;

-- ---------------------------------------------------------------------------
-- B: 상대 개인 일정은 보이지만 바꿀 수 없다. 공동 일정은 함께 바꾼다
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ub'), true);
select set_config('request.jwt.claim.sub', :'ub', true);
set local role authenticated;

do $do$
declare
  v_personal uuid := tests_support.get('e_personal_a')::uuid;
  v_shared   uuid := tests_support.get('e_shared')::uuid;
  v_allday   uuid := tests_support.get('e_allday')::uuid;
  v_result   jsonb;
begin
  -- 조회는 둘 다 가능하다(상대 개인 일정 포함)
  perform tests_support.eq(
    (select count(*)::integer from public.calendar_events e where e.id in (v_personal, v_shared, v_allday)),
    3, 'B도 공간의 모든 일정을 본다(상대 개인 일정 포함)');
  perform tests_support.eq(
    (select e.title from public.calendar_events e where e.id = v_personal),
    '치과 예약(변경)', 'B는 상대 개인 일정의 내용을 읽을 수 있다');

  -- 상대 개인 일정은 바꿀 수 없다(존재를 숨기지 않고 권한 없음으로 알린다)
  perform tests_support.expect_error(
    format($q$select public.save_calendar_event(%L, 'personal', 'B가 고침', null, '', false,
             date '2026-11-08', time '10:00', null, null, null, 5, gen_random_uuid())$q$, v_personal),
    'GF403', 'B는 상대 개인 일정을 수정할 수 없다');
  perform tests_support.expect_error(
    format($q$select public.set_calendar_event_status(%L, 'done', 5, gen_random_uuid())$q$, v_personal),
    'GF403', 'B는 상대 개인 일정을 완료 처리할 수 없다');
  perform tests_support.expect_error(
    format($q$select public.delete_calendar_event(%L, 5, gen_random_uuid())$q$, v_personal),
    'GF403', 'B는 상대 개인 일정을 삭제할 수 없다');
  perform tests_support.eq(
    (select e.version from public.calendar_events e where e.id = v_personal),
    5, '거부된 요청은 버전을 올리지 않는다');

  -- 공동 일정은 B도 바꾼다
  v_result := public.save_calendar_event(
    v_shared, 'date', '전시 보러 가기(B 수정)', '서울시립미술관', 'B가 예약',
    false, date '2026-12-05', time '13:00', date '2026-12-05', time '15:00',
    null, 1, gen_random_uuid());
  perform tests_support.eq((v_result ->> 'version')::integer, 2, 'B의 공동 일정 수정이 반영된다');
  perform tests_support.eq(
    (select e.created_by from public.calendar_events e where e.id = v_shared),
    'c1111111-1111-4111-8111-111111111111'::uuid, '작성자는 바뀌지 않는다');

  v_result := public.set_calendar_event_status(v_shared, 'done', 2, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'status', 'done', 'B도 공동 일정을 완료 체크한다');

  -- 삭제: 실제 버전(1)과 다른 값은 아무것도 지우지 않는다
  perform tests_support.expect_error(
    format($q$select public.delete_calendar_event(%L, 7, gen_random_uuid())$q$, v_allday),
    'GF409', '낡은 버전의 삭제는 CONFLICT');
  perform tests_support.eq(
    (select count(*)::integer from public.calendar_events e where e.id = v_allday), 1,
    '거부된 삭제는 행을 남긴다');

  v_result := public.delete_calendar_event(v_allday, 1, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'eventId', v_allday::text, 'B가 공동 일정을 삭제한다');
  perform tests_support.eq(
    (select count(*)::integer from public.calendar_events e where e.id = v_allday), 0,
    '삭제된 일정은 사라진다');
  perform tests_support.expect_error(
    format($q$select public.delete_calendar_event(%L, 1, gen_random_uuid())$q$, v_allday),
    'GF404', '없는 일정 삭제는 NOT_FOUND');

  -- B의 개인 일정은 B가 만든다. 소유자는 언제나 만든 사람이다.
  v_result := public.save_calendar_event(
    null, 'personal', 'B의 야근', null, '',
    false, date '2026-11-10', time '19:00', null, null,
    null, 0, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'ownerId', 'c2222222-2222-4222-8222-222222222222',
    'B가 만든 개인 일정의 소유자는 B다');
  perform tests_support.put('e_personal_b', v_result ->> 'eventId');
end;
$do$;

-- ---------------------------------------------------------------------------
-- A: 자기 개인 일정은 바꿀 수 있고, B의 개인 일정은 바꿀 수 없다
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare
  v_mine   uuid := tests_support.get('e_personal_a')::uuid;
  v_theirs uuid := tests_support.get('e_personal_b')::uuid;
  v_result jsonb;
begin
  v_result := public.set_calendar_event_status(v_mine, 'done', 5, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'status', 'done', 'A는 자기 개인 일정을 완료 처리한다');
  perform tests_support.expect_error(
    format($q$select public.set_calendar_event_status(%L, 'done', 1, gen_random_uuid())$q$, v_theirs),
    'GF403', 'A는 B의 개인 일정을 완료 처리할 수 없다');
  v_result := public.delete_calendar_event(v_mine, 6, gen_random_uuid());
  perform tests_support.eq(v_result ->> 'eventId', v_mine::text, 'A는 자기 개인 일정을 삭제한다');
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
  v_shared uuid := tests_support.get('e_shared')::uuid;
begin
  perform tests_support.eq(
    (select count(*)::integer from public.calendar_events e where e.id = v_shared),
    0, '외부 공간 계정에게는 일정이 보이지 않는다');
  perform tests_support.expect_error(
    format($q$select public.save_calendar_event(%L, 'date', '가로채기', null, '', false,
             date '2026-12-05', time '13:00', null, null, null, 3, gen_random_uuid())$q$, v_shared),
    'GF404', '외부 계정의 수정은 NOT_FOUND');
  perform tests_support.expect_error(
    format($q$select public.set_calendar_event_status(%L, 'cancelled', 3, gen_random_uuid())$q$, v_shared),
    'GF404', '외부 계정의 상태 변경은 NOT_FOUND');
  perform tests_support.expect_error(
    format($q$select public.delete_calendar_event(%L, 3, gen_random_uuid())$q$, v_shared),
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
  'select id from public.calendar_events', '42501', '비로그인은 일정을 볼 수 없다');
select tests_support.expect_error(
  $q$select public.save_calendar_event(null, 'date', '비로그인', null, '', false,
           current_date, time '10:00', null, null, null, 0, gen_random_uuid())$q$,
  '42501', '비로그인은 save_calendar_event를 호출할 수 없다');
select tests_support.expect_error(
  $q$select public.set_calendar_event_status(gen_random_uuid(), 'done', 1, gen_random_uuid())$q$,
  '42501', '비로그인은 set_calendar_event_status를 호출할 수 없다');
select tests_support.expect_error(
  $q$select public.delete_calendar_event(gen_random_uuid(), 1, gen_random_uuid())$q$,
  '42501', '비로그인은 delete_calendar_event를 호출할 수 없다');

-- ---------------------------------------------------------------------------
-- 위시가 아닌 FK 위반은 "위시가 사라졌어요"로 바꾸지 않는다 (독립 검토 P3-4)
-- ---------------------------------------------------------------------------
-- save_calendar_event의 FK 핸들러가 위시 복합 FK일 때만 CONFLICT{"wishItemId":"gone"}을 쓰고,
-- 다른 FK 위반은 원래 예외를 그대로 올려야 한다.
--
-- 실제 제품 스키마에서는 그 상황을 한 세션으로 만들 수 없다. `created_by`·`owner_id`가 가리키는
-- 프로필은 `space_members`가 이미 보장하고, 공간·프로필 삭제 RPC도 없다. 그래서 이 트랜잭션 안에서만
-- 사는 **검사용 FK를 하나 더 달아** 그 경로를 실제로 통과시킨다(롤백과 함께 사라진다).
-- `not valid`로 달아 기존 행을 다시 검사하지 않게 한다(새 INSERT/UPDATE에는 그대로 적용된다).
reset role;

create table tests_support.allowed_locations (location text primary key);
-- FK 검사는 참조되는 테이블을 읽는다. 검사용 테이블이므로 읽기를 열어 둔다(롤백과 함께 사라진다).
grant select on table tests_support.allowed_locations to public;
-- 허용 값은 소유자 권한으로 미리 넣는다(역할을 바꾼 뒤에는 이 테이블에 쓸 수 없다).
insert into tests_support.allowed_locations (location) values ('있는 장소');
alter table public.calendar_events
  add constraint calendar_events_test_location_fk
  foreign key (location) references tests_support.allowed_locations (location) not valid;

select set_config('request.jwt.claims', tests_support.claims(:'ua'), true);
select set_config('request.jwt.claim.sub', :'ua', true);
set local role authenticated;

do $do$
declare
  v_state text;
begin
  -- 허용 목록에 없는 장소 → calendar_events_test_location_fk 위반(위시 제약이 아니다).
  v_state := tests_support.try_sqlstate(
    $q$select public.save_calendar_event(null, 'date', 'FK 매핑', '없는 장소', '', false,
             date '2026-11-07', time '10:00', null, null, null, 0, gen_random_uuid())$q$);
  -- 고치기 전에는 GF409(위시가 사라졌어요)가 나왔다. 이제 원래 FK 위반이 그대로 올라온다.
  perform tests_support.eq(v_state, '23503',
    '위시가 아닌 FK 위반은 23503 그대로 올라온다(위시 안내로 바뀌지 않는다)');

  -- 같은 함수가 허용된 장소로는 정상 동작한다(핸들러가 정상 경로를 막지 않는다).
  v_state := tests_support.try_sqlstate(
    $q$select public.save_calendar_event(null, 'date', 'FK 매핑 정상', '있는 장소', '', false,
             date '2026-11-07', time '11:00', null, null, null, 0, gen_random_uuid())$q$);
  perform tests_support.eq(v_state, null, '허용된 값이면 정상 저장된다');
end;
$do$;

reset role;
alter table public.calendar_events drop constraint calendar_events_test_location_fk;

-- ---------------------------------------------------------------------------
-- 공간 cascade 삭제 (설계 결정 6: 복합 FK가 `no action`이어야 통과한다, 독립 검토 P3-8)
-- ---------------------------------------------------------------------------
-- 공간을 지우면 위시와 일정이 함께 cascade로 사라진다. 복합 FK가 `restrict`였다면 즉시 검사 때문에
-- 공간 삭제 자체가 실패한다. `no action`은 문장 끝에 검사하므로 둘이 함께 사라지는 경우를 통과시킨다.
-- MVP에 공간 삭제 RPC가 없어 제품 경로로는 실행되지 않는 전제였다. 소유자 권한으로 직접 확인한다.
\set ud 'c4444444-4444-4444-8444-444444444444'
\set s3 'cccccca3-cccc-4ccc-8ccc-ccccccccccc3'

select tests_support.make_user(:'ud', 'cal91-d@test.invalid');
select tests_support.make_profile(:'ud', '디이');
select tests_support.make_space(:'s3', :'ud', 'cascade 공간');

do $do$
declare
  v_space uuid := 'cccccca3-cccc-4ccc-8ccc-ccccccccccc3';
  v_user  uuid := 'c4444444-4444-4444-8444-444444444444';
  v_wish  uuid;
  v_date  uuid;
  v_own   uuid;
begin
  insert into public.wish_items (space_id, created_by, title)
  values (v_space, v_user, 'cascade 위시')
  returning id into v_wish;

  insert into public.calendar_events (
    space_id, created_by, owner_id, kind, title, starts_at, ends_at, all_day, wish_item_id)
  values (
    v_space, v_user, null, 'date', 'cascade 공동 일정',
    app_private.kst_moment(date '2026-11-07', time '10:00'), null, false, v_wish)
  returning id into v_date;

  insert into public.calendar_events (
    space_id, created_by, owner_id, kind, title, starts_at, ends_at, all_day)
  values (
    v_space, v_user, v_user, 'personal', 'cascade 개인 일정',
    app_private.kst_moment(date '2026-11-08', null),
    app_private.kst_moment(date '2026-11-08', null), true)
  returning id into v_own;

  perform tests_support.eq(
    (select count(*)::integer from public.calendar_events e where e.space_id = v_space),
    2, 'cascade 확인용 일정 2건 준비');

  -- 연결된 일정이 있는 위시는 직접 삭제도 FK가 막는다(RPC 검사와 별개인 마지막 방어선).
  perform tests_support.expect_error(
    format($q$delete from public.wish_items where id = %L$q$, v_wish),
    '23503', '연결된 일정이 있는 위시는 직접 삭제도 FK가 막는다');

  -- 공간 삭제는 위시·일정을 함께 지우며 성공해야 한다.
  delete from public.spaces s where s.id = v_space;

  perform tests_support.eq(
    (select count(*)::integer from public.calendar_events e where e.space_id = v_space),
    0, '공간을 지우면 일정도 함께 사라진다');
  perform tests_support.eq(
    (select count(*)::integer from public.wish_items w where w.space_id = v_space),
    0, '공간을 지우면 위시도 함께 사라진다');
  perform tests_support.eq(
    (select count(*)::integer from public.spaces s where s.id = v_space),
    0, '공간이 사라진다');
end;
$do$;

-- 남은 한계: 위시 삭제와 일정 생성의 **동시** 직렬화(FOR UPDATE ↔ FOR KEY SHARE)는 한 세션으로
-- 재현할 수 없다. 이 파일은 단일 세션 검증이며, 두 세션 동시성 시나리오는 미작성이다
-- (`supabase/tests/concurrency`류의 별도 스크립트가 필요하다).

reset role;
rollback;
