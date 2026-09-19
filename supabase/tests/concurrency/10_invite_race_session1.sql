-- 동시 수락 경쟁 — 세션 1 (사용자 B)
-- 먼저 spaces 행을 잠그고, 세션 2가 그 잠금을 기다리는 것을 확인한 뒤 커밋한다.
-- 커밋은 authenticated 역할 그대로 수행한다(지연 정원 트리거의 실제 경로를 타기 위해).
-- 기대: 성공하고 구성원이 된다.

\set ON_ERROR_STOP on
\set rb '0c0c0c0c-0000-4000-8000-00000000000b'

begin;
-- 겹침 장치가 이 경쟁의 세션 2만 보도록 시나리오를 알린다(역할 전환 전에 설정한다).
select set_config('tests_race.scenario', 'invite', true);
select set_config('request.jwt.claims',
  json_build_object('sub', :'rb', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'rb', true);
set local role authenticated;

\echo 'session1(invite): accept_invite'
do $do$
declare
  v_state  text;
  v_result jsonb;
begin
  begin
    v_result := public.accept_invite('race-token-b-0000000000000000000000000000000000',
                                     '0c0c0c0c-0000-4000-8000-0000000000a1');
  exception when others then
    v_state := sqlstate;
  end;
  insert into tests_race.results (scenario, session_no, sqlstate, result)
  values ('invite', 1, v_state, v_result);
end;
$do$;

\ir _barrier.sql
commit;
\echo 'session1(invite): 커밋 완료'
