-- FOOD-001 겹침 보장 장치 (세션 1에서만 \ir로 읽는다)
--
-- DB-001 concurrency/_barrier.sql과 같은 방식이며 스키마만 tests_food_race를 쓴다.
--   1) 세션 2가 시작 직후 자기 pid를 tests_food_race.sessions에 커밋해 알린다.
--   2) 세션 1은 pg_blocking_pids(세션2 pid)에 **자기 pid**가 들어 있을 때까지 기다린다.
-- 20초 안에 확인하지 못하면 예외로 세션 1을 실패시킨다(순차 실행을 통과로 기록하지 않는다).

do $barrier$
declare
  v_scenario text := current_setting('tests_food_race.scenario', true);
  v_pid      integer;
  v_blocked  boolean := false;
  i          integer;
begin
  if v_scenario is null or v_scenario = '' then
    raise exception '겹침 실패: tests_food_race.scenario가 설정되지 않았다' using errcode = 'TS002';
  end if;

  for i in 1..400 loop
    select s.pid into v_pid
      from tests_food_race.sessions s
     where s.scenario = v_scenario and s.session_no = 2;

    if v_pid is not null then
      select pg_backend_pid() = any(pg_blocking_pids(v_pid)) into v_blocked;
      exit when v_blocked;
    end if;

    perform pg_sleep(0.05);
  end loop;

  if not v_blocked then
    if v_pid is null then
      raise exception '겹침 실패[%]: 세션 2가 pid를 알리지 않았다', v_scenario using errcode = 'TS002';
    end if;
    raise exception '겹침 실패[%]: 세션 2(pid %)가 이 세션 때문에 막히지 않았다(20초 대기)',
      v_scenario, v_pid using errcode = 'TS002';
  end if;

  raise notice 'barrier[%]: 세션 2(pid %)가 이 세션의 잠금을 기다린다. 커밋한다.', v_scenario, v_pid;
end;
$barrier$;
