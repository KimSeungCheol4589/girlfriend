-- FOOD-001 동시성 — 세션 2 (세션 1의 잠금을 기다리는 쪽)
-- 사용: psql -v scenario=<이름> -f session2.sql
-- 시작 직후 자기 backend pid를 커밋해 알린다. 세션 1의 _barrier.sql이 이 pid의 대기 원인을 확인한다.

\set ON_ERROR_STOP on

insert into tests_food_race.sessions (scenario, session_no, pid)
values (:'scenario', 2, pg_backend_pid())
on conflict (scenario, session_no) do update set pid = excluded.pid;

begin;
set local role authenticated;

\echo 'session2: 작업 실행 (세션 1 대기 예상)'
select tests_food_race.run(:'scenario', 2);

commit;
\echo 'session2: 종료'
