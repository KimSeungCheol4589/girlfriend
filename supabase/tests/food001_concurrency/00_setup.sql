-- FOOD-001 동시성 테스트 — 픽스처·결과 기록소·시나리오 실행 함수 (커밋된다)
--
-- DB-001 동시성 스위트(tests_race)와 스키마·ID를 공유하지 않는다: 스키마 tests_food_race,
-- 고정 UUID 접두사 0f00d001-…. 99_teardown.sql이 이 고정 ID만 지운다. 모든 신원은 합성이다.
--
-- 시나리오(각자 전용 맛집, 모두 visited·version 1에서 시작)
--   review_vs_cancel         s1 B 새 후기 저장         ↔ s2 A 확인형 방문 취소(expectedVersion 1)
--   edit_vs_delete           s1 B 기존 후기 수정       ↔ s2 A 확인형 맛집 삭제(expectedVersion 1)
--   two_reviews              s1 A 새 후기              ↔ s2 B 새 후기
--   cancel_vs_review         s1 A 확인 없는 방문 취소  ↔ s2 B 새 후기
--   review_delete_vs_cancel  s1 B 기존 후기 삭제       ↔ s2 A 확인형 방문 취소(expectedVersion 1)
--   retry                    s1 B 새 후기(requestId X) ↔ s2 B 같은 요청 재전송(requestId X, 같은 입력)
--
-- 세션 1은 잠금을 쥔 채 _barrier.sql로 "세션 2가 바로 나 때문에 막혔다"를 확인한 뒤 커밋한다.

\set ON_ERROR_STOP on

\set fa '0f00d001-0000-4000-8000-00000000000a'
\set fb '0f00d001-0000-4000-8000-00000000000b'
\set fspace '0f00d001-0000-4000-8000-0000000000f1'

begin;

-- 이전 실행의 잔여물(같은 고정 ID)만 정리한다.
delete from public.mutation_requests where user_id in (:'fa', :'fb');
delete from public.spaces where id = :'fspace';
delete from public.profiles where id in (:'fa', :'fb');
delete from auth.users where id in (:'fa', :'fb');

drop schema if exists tests_food_race cascade;
create schema tests_food_race;
grant usage on schema tests_food_race to public;

create table tests_food_race.results (
  scenario    text not null,
  session_no  integer not null,
  sqlstate    text,
  detail      text,
  result      jsonb,
  recorded_at timestamptz not null default now(),
  primary key (scenario, session_no)
);
grant all on table tests_food_race.results to public;

create table tests_food_race.sessions (
  scenario   text not null,
  session_no integer not null,
  pid        integer not null,
  primary key (scenario, session_no)
);
grant all on table tests_food_race.sessions to public;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  (:'fa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'food001-race-a@test.invalid', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  (:'fb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'food001-race-b@test.invalid', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

insert into public.profiles (id, nickname) values (:'fa', '푸드레이스A'), (:'fb', '푸드레이스B');
insert into public.spaces (id, created_by, name) values (:'fspace', :'fa', 'FOOD 동시성 공간');
insert into public.space_members (space_id, user_id) values (:'fspace', :'fa'), (:'fspace', :'fb');
insert into public.space_settings (space_id) values (:'fspace');

-- 맛집 c1~c6: 모두 visited, version 1
insert into public.restaurants (id, space_id, created_by, name, status, visited_date)
select ('0f00d001-0000-4000-8000-0000000000c' || n)::uuid, :'fspace', :'fa',
       '동시성 맛집 ' || n, 'visited', current_date - 1
  from generate_series(1, 6) as g(n);

-- 기존 B 후기: c2(수정 대상), c5(삭제 대상). 직접 넣으므로 맛집 버전은 1 그대로다.
insert into public.restaurant_reviews (id, restaurant_id, space_id, user_id, rating, comment) values
  ('0f00d001-0000-4000-8000-0000000000e2', '0f00d001-0000-4000-8000-0000000000c2', :'fspace', :'fb', 4, 'B 원래 후기'),
  ('0f00d001-0000-4000-8000-0000000000e5', '0f00d001-0000-4000-8000-0000000000c5', :'fspace', :'fb', 3, 'B 지울 후기');

-- ---------------------------------------------------------------------------
-- 시나리오 실행: 호출자 권한(SECURITY INVOKER)으로 공개 RPC를 부른다.
-- 세션 스크립트가 SET ROLE authenticated를 한 뒤 호출하므로 RPC는 로그인 사용자 권한으로 실행된다.
-- 기대된 거부도 여기서 잡아 기록한다(스크립트 종료 코드 0 유지).
-- ---------------------------------------------------------------------------
create or replace function tests_food_race.run(p_scenario text, p_session integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_a constant uuid := '0f00d001-0000-4000-8000-00000000000a';
  c_b constant uuid := '0f00d001-0000-4000-8000-00000000000b';
  v_user   uuid;
  v_state  text;
  v_detail text;
  v_result jsonb;
begin
  v_user := case
    when p_scenario = 'review_vs_cancel'        then (case p_session when 1 then c_b else c_a end)
    when p_scenario = 'edit_vs_delete'          then (case p_session when 1 then c_b else c_a end)
    when p_scenario = 'two_reviews'             then (case p_session when 1 then c_a else c_b end)
    when p_scenario = 'cancel_vs_review'        then (case p_session when 1 then c_a else c_b end)
    when p_scenario = 'review_delete_vs_cancel' then (case p_session when 1 then c_b else c_a end)
    when p_scenario = 'retry'                   then c_b
  end;
  if v_user is null then
    raise exception '알 수 없는 시나리오: %', p_scenario using errcode = 'TS003';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  begin
    case p_scenario || ':' || p_session
      when 'review_vs_cancel:1' then
        v_result := public.save_review('0f00d001-0000-4000-8000-0000000000c1', 5::smallint, 'B 새 후기', 0,
                      '0f00d001-0000-4000-8000-0000000001a1');
      when 'review_vs_cancel:2' then
        v_result := public.set_restaurant_status('0f00d001-0000-4000-8000-0000000000c1', 'wishlist', null, true, 1,
                      '0f00d001-0000-4000-8000-0000000001a2');
      when 'edit_vs_delete:1' then
        v_result := public.save_review('0f00d001-0000-4000-8000-0000000000c2', 1::smallint, 'B 수정한 후기', 1,
                      '0f00d001-0000-4000-8000-0000000002a1');
      when 'edit_vs_delete:2' then
        v_result := public.delete_restaurant_confirmed('0f00d001-0000-4000-8000-0000000000c2', true, 1,
                      '0f00d001-0000-4000-8000-0000000002a2');
      when 'two_reviews:1' then
        v_result := public.save_review('0f00d001-0000-4000-8000-0000000000c3', 4::smallint, 'A 후기', 0,
                      '0f00d001-0000-4000-8000-0000000003a1');
      when 'two_reviews:2' then
        v_result := public.save_review('0f00d001-0000-4000-8000-0000000000c3', 3::smallint, 'B 후기', 0,
                      '0f00d001-0000-4000-8000-0000000003a2');
      when 'cancel_vs_review:1' then
        v_result := public.set_restaurant_status('0f00d001-0000-4000-8000-0000000000c4', 'wishlist', null, false, 1,
                      '0f00d001-0000-4000-8000-0000000004a1');
      when 'cancel_vs_review:2' then
        v_result := public.save_review('0f00d001-0000-4000-8000-0000000000c4', 5::smallint, 'B 늦은 후기', 0,
                      '0f00d001-0000-4000-8000-0000000004a2');
      when 'review_delete_vs_cancel:1' then
        v_result := public.delete_review('0f00d001-0000-4000-8000-0000000000e5', 1,
                      '0f00d001-0000-4000-8000-0000000005a1');
      when 'review_delete_vs_cancel:2' then
        v_result := public.set_restaurant_status('0f00d001-0000-4000-8000-0000000000c5', 'wishlist', null, true, 1,
                      '0f00d001-0000-4000-8000-0000000005a2');
      when 'retry:1', 'retry:2' then
        -- 두 세션이 같은 requestId·같은 입력을 보낸다(응답 유실 후 재전송).
        v_result := public.save_review('0f00d001-0000-4000-8000-0000000000c6', 4::smallint, '재전송 후기', 0,
                      '0f00d001-0000-4000-8000-0000000006a0');
    end case;
  exception when others then
    v_state := sqlstate;
    get stacked diagnostics v_detail = pg_exception_detail;
  end;

  insert into tests_food_race.results (scenario, session_no, sqlstate, detail, result)
  values (p_scenario, p_session, v_state, v_detail, v_result);
end;
$$;

grant execute on function tests_food_race.run(text, integer) to authenticated;

commit;

\echo 'FOOD-001 동시성 픽스처 생성 완료'
