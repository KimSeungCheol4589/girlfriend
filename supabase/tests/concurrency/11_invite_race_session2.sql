-- 동시 수락 경쟁 — 세션 2 (사용자 E)
-- 세션 1보다 조금 늦게 시작한다. spaces 행 잠금에서 대기하다가
-- 세션 1이 커밋한 뒤 정원(2명)을 확인하게 된다.
-- 기대: 거부된다. 두 가지 SQLSTATE 모두 정상이다.
--   GF411 SPACE_FULL     — 정원 확인에서 걸린 경우
--   GF410 INVITE_INVALID — 세션 1이 정원을 채우며 남은 초대를 폐기한 뒤 재확인된 경우
-- 어느 쪽이든 E는 구성원이 되면 안 된다. 최종 판정은 90_verify.sql이 한다.
-- 성공하면 정원 초과 결함이다.

\set ON_ERROR_STOP off
\set re '0c0c0c0c-0000-4000-8000-00000000000e'

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', :'re', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'re', true);
set local role authenticated;

\echo 'session2: accept_invite 시작 (대기 예상)'
select public.accept_invite('race-token-e-0000000000000000000000000000000000',
                            '0c0c0c0c-0000-4000-8000-0000000000a2') as session2_result;
commit;
\echo 'session2: 종료'
