-- 동시 수락 경쟁 — 세션 1 (사용자 B)
-- 이 세션이 먼저 spaces 행을 잠그고 2초 동안 트랜잭션을 유지한다.
-- 기대: 성공하고 구성원이 된다.

\set ON_ERROR_STOP on
\set rb '0c0c0c0c-0000-4000-8000-00000000000b'

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', :'rb', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'rb', true);
set local role authenticated;

\echo 'session1: accept_invite 시작'
select public.accept_invite('race-token-b-0000000000000000000000000000000000',
                            '0c0c0c0c-0000-4000-8000-0000000000a1') as session1_result;
-- 잠금을 유지한 채 세션 2가 대기하도록 만든다.
select pg_sleep(2);
commit;
\echo 'session1: 커밋 완료'
