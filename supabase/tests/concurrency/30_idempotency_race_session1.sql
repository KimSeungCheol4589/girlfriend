-- 중복 요청 경쟁 — 세션 1 (사용자 A)
-- 같은 requestId로 새 추억을 만들고 2초간 트랜잭션을 유지한다.
-- 기대: 새 추억 1건 생성.

\set ON_ERROR_STOP on
\set ra '0c0c0c0c-0000-4000-8000-00000000000a'

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', :'ra', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'ra', true);
set local role authenticated;

\echo 'session1: save_memory(신규, 같은 requestId) 시작'
select public.save_memory(null, '중복 제출 추억', '', current_date - 1, null,
                          array[]::text[], array[]::uuid[], false, 0,
                          '0c0c0c0c-0000-4000-8000-0000000000c1') as session1_result;
select pg_sleep(2);
commit;
\echo 'session1: 커밋 완료'
