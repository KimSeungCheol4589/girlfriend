-- 겹침 보장 장치 (세션 1에서만 \ir로 읽어 들인다)
--
-- 세션 1은 잠금을 쥔 채, **이 경쟁의 세션 2가 바로 나 때문에** 막힐 때까지 기다린다.
--
-- 판정 근거
--   1) 세션 2가 시작 직후 자기 backend pid를 tests_race.sessions에 **커밋해서** 알린다.
--      (세션 1은 READ COMMITTED이므로 루프의 매 SELECT가 새 스냅샷을 본다.)
--   2) 세션 1은 pg_blocking_pids(세션2 pid)에 **자기 pid가 들어 있는지** 확인한다.
--   cluster 전체의 아무 잠금 대기나 세는 방식은 쓰지 않는다. 무관한 대기를 겹침으로 오인하지 않는다.
--
-- pg_stat_activity는 쓸 수 없다. SET ROLE authenticated 이후에는 다른 세션의 열이 대부분 NULL이다.
-- pg_blocking_pids()와 tests_race.sessions 조회는 권한 제약이 없어 authenticated로도 확인할 수 있다.
--
-- 역할은 절대 되돌리지 않는다. 커밋 시점 지연 트리거의 보안 컨텍스트를 그대로 재현해야 한다.
--
-- 겹치지 않으면 예외를 던져 세션 1을 실패시킨다(순차 실행을 통과로 기록하지 않기 위해서다).

do $barrier$
declare
  v_scenario text := current_setting('tests_race.scenario', true);
  v_pid      integer;
  v_blocked  boolean := false;
  i          integer;
begin
  if v_scenario is null or v_scenario = '' then
    raise exception '겹침 실패: tests_race.scenario가 설정되지 않았다' using errcode = 'TS002';
  end if;

  for i in 1..400 loop
    select s.pid into v_pid
      from tests_race.sessions s
     where s.scenario = v_scenario and s.session_no = 2;

    if v_pid is not null then
      select pg_backend_pid() = any(pg_blocking_pids(v_pid)) into v_blocked;
      exit when v_blocked;
    end if;

    perform pg_sleep(0.05);
  end loop;

  if not v_blocked then
    if v_pid is null then
      raise exception '겹침 실패[%]: 세션 2가 pid를 알리지 않았다(시작 실패 가능)', v_scenario
        using errcode = 'TS002';
    end if;
    raise exception '겹침 실패[%]: 세션 2(pid %)가 이 세션 때문에 막히지 않았다(20초 대기)',
      v_scenario, v_pid using errcode = 'TS002';
  end if;

  raise notice 'barrier[%]: 세션 2(pid %)가 이 세션의 잠금을 기다린다. 커밋한다.', v_scenario, v_pid;
end;
$barrier$;
