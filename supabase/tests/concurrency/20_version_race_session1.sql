-- 동시 수정 경쟁 — 세션 1 (사용자 A)
-- 같은 추억을 expectedVersion=1로 저장하고 2초간 트랜잭션을 유지한다.
-- 기대: 성공하고 버전이 2가 된다.

\set ON_ERROR_STOP on
\set ra '0c0c0c0c-0000-4000-8000-00000000000a'
\set rmemory '0c0c0c0c-0000-4000-8000-0000000000d1'

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', :'ra', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'ra', true);
set local role authenticated;

\echo 'session1: save_memory(expectedVersion=1) 시작'
select public.save_memory(:'rmemory', 'A가 먼저 저장', '', current_date - 1, null,
                          array[]::text[], array[]::uuid[], false, 1,
                          '0c0c0c0c-0000-4000-8000-0000000000b1') as session1_result;
select pg_sleep(2);
commit;
\echo 'session1: 커밋 완료'
