-- 중복 요청 경쟁 — 세션 2 (사용자 A, 같은 requestId·같은 입력)
-- 네트워크 응답 유실 후 재전송을 흉내 낸다.
-- 기대: 세션 1이 커밋될 때까지 대기한 뒤 세션 1과 **동일한 memoryId**를 돌려받는다.
--       추억이 두 건 생기거나 다른 ID가 나오면 결함이다.

\set ON_ERROR_STOP on
\set ra '0c0c0c0c-0000-4000-8000-00000000000a'

insert into tests_race.sessions (scenario, session_no, pid)
values ('idempotency', 2, pg_backend_pid())
on conflict (scenario, session_no) do update set pid = excluded.pid;

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', :'ra', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'ra', true);
set local role authenticated;

\echo 'session2(idempotency): 같은 requestId 재전송 (대기 예상)'
do $do$
declare
  v_state  text;
  v_detail text;
  v_result jsonb;
begin
  begin
    v_result := public.save_memory(null, '중복 제출 추억', '', current_date - 1, null,
                  array[]::text[], array[]::uuid[], false, 0,
                  '0c0c0c0c-0000-4000-8000-0000000000c1');
  exception when others then
    v_state := sqlstate;
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  insert into tests_race.results (scenario, session_no, sqlstate, detail, result)
  values ('idempotency', 2, v_state, v_detail, v_result);
end;
$do$;

commit;
\echo 'session2(idempotency): 종료'
