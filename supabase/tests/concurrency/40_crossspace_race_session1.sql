-- 서로 다른 공간 동시 수락 — 세션 1 (사용자 F, 공간 X)
--
-- 두 세션이 서로 다른 공간 행을 잠그므로 공간 잠금으로는 직렬화되지 않는다.
-- 계정당 공간 하나 UNIQUE가 최종 방어이며, 늦은 쪽은 원시 23505가 아니라
-- 계약 코드 GF409를 받아야 한다(검토 지적 D3).
--
-- 기대: 성공하고 공간 X의 구성원이 된다.

\set ON_ERROR_STOP on
\set rf '0c0c0c0c-0000-4000-8000-00000000000f'

begin;
select set_config('tests_race.scenario', 'crossspace', true);
select set_config('request.jwt.claims',
  json_build_object('sub', :'rf', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'rf', true);
set local role authenticated;

\echo 'session1(crossspace): accept_invite(공간 X)'
do $do$
declare
  v_state  text;
  v_result jsonb;
begin
  begin
    v_result := public.accept_invite('race-token-x-0000000000000000000000000000000000',
                                     '0c0c0c0c-0000-4000-8000-0000000000a3');
  exception when others then
    v_state := sqlstate;
  end;
  insert into tests_race.results (scenario, session_no, sqlstate, result)
  values ('crossspace', 1, v_state, v_result);
end;
$do$;

\ir _barrier.sql
commit;
\echo 'session1(crossspace): 커밋 완료'
