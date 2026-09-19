-- 첫 프로필 동시 생성 — 세션 1 (사용자 P, 프로필 없음)
--
-- 두 세션이 동시에 expectedVersion=0으로 첫 저장을 시도한다.
-- 늦은 쪽은 원시 23505가 아니라 계약 코드 GF409를 받아야 한다(검토 지적 D3).
--
-- 기대: 성공하고 프로필 버전 1이 된다.

\set ON_ERROR_STOP on
\set rp '0c0c0c0c-0000-4000-8000-000000000013'

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', :'rp', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'rp', true);
set local role authenticated;

\echo 'session1(profile): update_profile(첫 저장)'
do $do$
declare
  v_state  text;
  v_result jsonb;
begin
  begin
    v_result := public.update_profile('먼저쓴닉네임', 0,
                                      '0c0c0c0c-0000-4000-8000-0000000000e1');
  exception when others then
    v_state := sqlstate;
  end;
  insert into tests_race.results (scenario, session_no, sqlstate, result)
  values ('profile', 1, v_state, v_result);
end;
$do$;

\ir _barrier.sql
commit;
\echo 'session1(profile): 커밋 완료'
