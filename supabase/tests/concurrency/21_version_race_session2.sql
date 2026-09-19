-- 동시 수정 경쟁 — 세션 2 (사용자 B)
-- 같은 추억을 같은 expectedVersion=1로 저장한다.
-- 기대: 세션 1이 커밋될 때까지 대기한 뒤 CONFLICT(SQLSTATE GF409)로 거부된다.
--       조용한 덮어쓰기가 일어나면 결함이다.

\set ON_ERROR_STOP off
\set rb '0c0c0c0c-0000-4000-8000-00000000000b'
\set rmemory '0c0c0c0c-0000-4000-8000-0000000000d1'

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', :'rb', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'rb', true);
set local role authenticated;

\echo 'session2: save_memory(expectedVersion=1) 시작 (대기 예상)'
select public.save_memory(:'rmemory', 'B가 나중에 저장', '', current_date - 1, null,
                          array[]::text[], array[]::uuid[], false, 1,
                          '0c0c0c0c-0000-4000-8000-0000000000b2') as session2_result;
commit;
\echo 'session2: 종료'
