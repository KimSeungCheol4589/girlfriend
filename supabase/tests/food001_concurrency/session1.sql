-- FOOD-001 동시성 — 세션 1 (먼저 잠금을 쥐는 쪽)
-- 사용: psql -v scenario=<이름> -f session1.sql
-- 시나리오 작업을 실행해 맛집 행 잠금을 쥔 채, 세션 2가 **바로 이 세션 때문에** 막힌 것을 확인한 뒤 커밋한다.
-- 역할은 커밋까지 authenticated로 유지한다.

\set ON_ERROR_STOP on

begin;
select set_config('tests_food_race.scenario', :'scenario', true);
set local role authenticated;

\echo 'session1: 작업 실행'
select tests_food_race.run(:'scenario', 1);

\ir _barrier.sql
commit;
\echo 'session1: 커밋 완료'
