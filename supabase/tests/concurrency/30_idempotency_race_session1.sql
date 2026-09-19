-- 중복 요청 경쟁 — 세션 1 (사용자 A)
-- 같은 requestId로 새 추억을 만들고, 세션 2가 멱등성 행 잠금을 기다리는 것을 확인한 뒤 커밋한다.
-- 기대: 새 추억 1건 생성.

\set ON_ERROR_STOP on
\set ra '0c0c0c0c-0000-4000-8000-00000000000a'

begin;
select set_config('tests_race.scenario', 'idempotency', true);
select set_config('request.jwt.claims',
  json_build_object('sub', :'ra', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'ra', true);
set local role authenticated;

\echo 'session1(idempotency): save_memory(신규, 같은 requestId)'
do $do$
declare
  v_state  text;
  v_result jsonb;
begin
  begin
    v_result := public.save_memory(null, '중복 제출 추억', '', current_date - 1, null,
                  array[]::text[], array[]::uuid[], false, 0,
                  '0c0c0c0c-0000-4000-8000-0000000000c1');
  exception when others then
    v_state := sqlstate;
  end;
  insert into tests_race.results (scenario, session_no, sqlstate, result)
  values ('idempotency', 1, v_state, v_result);
end;
$do$;

\ir _barrier.sql
commit;
\echo 'session1(idempotency): 커밋 완료'
