-- 첫 프로필 동시 생성 — 세션 2 (같은 사용자 P, 다른 requestId)
--
-- 세션 1이 커밋하기 전에는 프로필 행이 보이지 않으므로 이쪽도 생성 경로를 탄다.
-- PK UNIQUE에서 대기하다가 세션 1 커밋 후 실패한다.
-- 기대: **GF409**(CONFLICT). 원시 23505가 나오면 계약 위반이다.

\set ON_ERROR_STOP on
\set rp '0c0c0c0c-0000-4000-8000-000000000013'

insert into tests_race.sessions (scenario, session_no, pid)
values ('profile', 2, pg_backend_pid())
on conflict (scenario, session_no) do update set pid = excluded.pid;

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', :'rp', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'rp', true);
set local role authenticated;

\echo 'session2(profile): update_profile(첫 저장, 대기 예상)'
do $do$
declare
  v_state  text;
  v_detail text;
  v_result jsonb;
begin
  begin
    v_result := public.update_profile('나중쓴닉네임', 0,
                                      '0c0c0c0c-0000-4000-8000-0000000000e2');
  exception when others then
    v_state := sqlstate;
    -- DETAIL의 진단용 path 키로 "사전 검사"가 아니라 "UNIQUE 예외 핸들러"를 탔는지 구분한다.
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  insert into tests_race.results (scenario, session_no, sqlstate, detail, result)
  values ('profile', 2, v_state, v_detail, v_result);
end;
$do$;

commit;
\echo 'session2(profile): 종료'
