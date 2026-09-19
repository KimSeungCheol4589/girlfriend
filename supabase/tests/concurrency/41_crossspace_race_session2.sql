-- 서로 다른 공간 동시 수락 — 세션 2 (같은 사용자 F, 공간 Y)
--
-- 공간 Y의 행을 잠그므로 세션 1과 잠금이 겹치지 않는다.
-- 검사는 모두 통과하고 space_members 삽입에서 user_id UNIQUE를 기다리게 된다.
-- 기대: 세션 1 커밋 후 **GF409**(CONFLICT)로 거부된다. 원시 23505가 나오면 계약 위반이다.

\set ON_ERROR_STOP on
\set rf '0c0c0c0c-0000-4000-8000-00000000000f'

insert into tests_race.sessions (scenario, session_no, pid)
values ('crossspace', 2, pg_backend_pid())
on conflict (scenario, session_no) do update set pid = excluded.pid;

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', :'rf', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'rf', true);
set local role authenticated;

\echo 'session2(crossspace): accept_invite(공간 Y) (대기 예상)'
do $do$
declare
  v_state  text;
  v_detail text;
  v_result jsonb;
begin
  begin
    v_result := public.accept_invite('race-token-y-0000000000000000000000000000000000',
                                     '0c0c0c0c-0000-4000-8000-0000000000a4');
  exception when others then
    v_state := sqlstate;
    -- DETAIL의 진단용 path 키로 "사전 검사"가 아니라 "UNIQUE 예외 핸들러"를 탔는지 구분한다.
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  insert into tests_race.results (scenario, session_no, sqlstate, detail, result)
  values ('crossspace', 2, v_state, v_detail, v_result);
end;
$do$;

commit;
\echo 'session2(crossspace): 종료'
