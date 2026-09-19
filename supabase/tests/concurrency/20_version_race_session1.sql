-- 동시 수정 경쟁 — 세션 1 (사용자 A)
-- 같은 추억을 expectedVersion=1로 저장하고, 세션 2가 행 잠금을 기다리는 것을 확인한 뒤 커밋한다.
-- 기대: 성공하고 버전이 2가 된다.

\set ON_ERROR_STOP on
\set ra '0c0c0c0c-0000-4000-8000-00000000000a'
\set rmemory '0c0c0c0c-0000-4000-8000-0000000000d1'

begin;
select set_config('tests_race.scenario', 'version', true);
select set_config('request.jwt.claims',
  json_build_object('sub', :'ra', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'ra', true);
set local role authenticated;

\echo 'session1(version): save_memory(expectedVersion=1)'
do $do$
declare
  v_state  text;
  v_result jsonb;
begin
  begin
    v_result := public.save_memory('0c0c0c0c-0000-4000-8000-0000000000d1',
                  'A가 먼저 저장', '', current_date - 1, null,
                  array[]::text[], array[]::uuid[], false, 1,
                  '0c0c0c0c-0000-4000-8000-0000000000b1');
  exception when others then
    v_state := sqlstate;
  end;
  insert into tests_race.results (scenario, session_no, sqlstate, result)
  values ('version', 1, v_state, v_result);
end;
$do$;

\ir _barrier.sql
commit;
\echo 'session1(version): 커밋 완료'
