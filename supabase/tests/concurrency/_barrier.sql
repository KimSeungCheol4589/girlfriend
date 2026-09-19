-- 겹침 보장 장치 (세션 1에서만 \ir로 읽어 들인다)
--
-- 세션 1은 잠금을 쥔 채, 세션 2가 실제로 그 잠금을 기다리기 시작할 때까지 기다린다.
-- pg_locks는 특별한 권한 없이 모든 역할이 읽을 수 있으므로
-- authenticated 역할을 유지한 채 확인할 수 있다.
-- 역할을 postgres로 되돌리면 커밋 시점 지연 트리거의 보안 컨텍스트가 달라지므로
-- 여기서는 절대 RESET ROLE 하지 않는다.
--
-- 대기 상태로 들어오지 않으면 예외를 던져 세션 1을 실패시킨다.
-- (겹치지 않은 실행을 "통과"로 기록하지 않기 위해서다.)

do $barrier$
declare
  v_waiting integer := 0;
  i integer;
begin
  for i in 1..400 loop
    select count(*) into v_waiting
      from pg_locks l
     where not l.granted
       and l.pid <> pg_backend_pid();
    exit when v_waiting > 0;
    perform pg_sleep(0.05);
  end loop;
  if coalesce(v_waiting, 0) = 0 then
    raise exception '겹침 실패: 상대 세션이 잠금 대기 상태로 들어오지 않았다(20초 대기)'
      using errcode = 'TS002';
  end if;
  raise notice 'barrier: 상대 세션이 잠금 대기 중. 커밋한다.';
end;
$barrier$;
