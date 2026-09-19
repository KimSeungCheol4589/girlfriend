-- 동시 수락 경쟁 — 세션 2 (사용자 E)
-- 세션 1보다 늦게 시작해 spaces 행 잠금에서 대기한다.
-- 기대: 거부된다. 두 SQLSTATE 모두 정상이다.
--   GF411 SPACE_FULL     — 정원 확인에서 걸린 경우
--   GF410 INVITE_INVALID — 세션 1이 정원을 채우며 남은 초대를 폐기한 뒤 재확인된 경우
-- 어느 쪽이든 E는 구성원이 되면 안 된다. 최종 판정은 90_verify.sql이 한다.
--
-- 오류는 DO 블록 안에서 잡아 표에 기록한다. 그 밖의 오류는 스크립트를 실패시킨다.

\set ON_ERROR_STOP on
\set re '0c0c0c0c-0000-4000-8000-00000000000e'

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', :'re', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'re', true);
set local role authenticated;

\echo 'session2(invite): accept_invite (대기 예상)'
do $do$
declare
  v_state  text;
  v_result jsonb;
begin
  begin
    v_result := public.accept_invite('race-token-e-0000000000000000000000000000000000',
                                     '0c0c0c0c-0000-4000-8000-0000000000a2');
  exception when others then
    v_state := sqlstate;
  end;
  insert into tests_race.results (scenario, session_no, sqlstate, result)
  values ('invite', 2, v_state, v_result);
end;
$do$;

commit;
\echo 'session2(invite): 종료'
