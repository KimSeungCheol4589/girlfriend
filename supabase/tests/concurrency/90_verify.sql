-- 동시성 테스트 결과 검증 (postgres 세션에서 실행)
--
-- 판정 근거는 tests_race.results에 각 세션이 기록한 SQLSTATE·반환 JSON과 최종 DB 상태다.
-- 로그 문자열을 파싱하지 않는다. 기대한 행이 없으면 그것도 실패다.

\set ON_ERROR_STOP on

do $do$
declare
  v_rows     integer;
  v_s1       tests_race.results%rowtype;
  v_s2       tests_race.results%rowtype;
  v_members  integer;
  v_b        integer;
  v_e        integer;
  v_version  integer;
  v_title    text;
  v_dupes    integer;
  v_invite_loser text;
  v_space    uuid := '0c0c0c0c-0000-4000-8000-0000000000f1';
  v_memory   uuid := '0c0c0c0c-0000-4000-8000-0000000000d1';
begin
  -- 열 개 세션 결과가 모두 기록돼 있어야 한다(5개 시나리오 x 2세션).
  select count(*) into v_rows from tests_race.results;
  if v_rows <> 10 then
    raise exception '동시성 실패: 세션 결과가 %건이다(기대 10건). 겹침이 실행되지 않았을 수 있다', v_rows;
  end if;

  -- ---------------- 1) 초대 동시 수락 ----------------
  select * into v_s1 from tests_race.results r where r.scenario = 'invite' and r.session_no = 1;
  select * into v_s2 from tests_race.results r where r.scenario = 'invite' and r.session_no = 2;

  if v_s1.sqlstate is not null then
    raise exception '동시성 실패: 먼저 잠근 세션이 실패했다 (SQLSTATE %)', v_s1.sqlstate;
  end if;
  if v_s1.result ->> 'spaceId' <> v_space::text then
    raise exception '동시성 실패: 세션1이 다른 공간에 들어갔다 (%)', v_s1.result ->> 'spaceId';
  end if;
  if v_s2.sqlstate is null then
    raise exception '동시성 실패: 두 번째 수락이 성공했다. 정원 초과 결함이다';
  end if;
  if v_s2.sqlstate not in ('GF411', 'GF410') then
    raise exception '동시성 실패: 두 번째 수락의 오류 코드가 %다(기대 GF411 또는 GF410)', v_s2.sqlstate;
  end if;
  v_invite_loser := v_s2.sqlstate;

  select count(*) into v_members from public.space_members m where m.space_id = v_space;
  if v_members <> 2 then
    raise exception '동시성 실패: 구성원 수가 %명이다(기대 2명)', v_members;
  end if;
  select count(*) into v_b from public.space_members m
   where m.space_id = v_space and m.user_id = '0c0c0c0c-0000-4000-8000-00000000000b';
  select count(*) into v_e from public.space_members m
   where m.space_id = v_space and m.user_id = '0c0c0c0c-0000-4000-8000-00000000000e';
  if v_b <> 1 or v_e <> 0 then
    raise exception '동시성 실패: 먼저 잠근 세션(B)만 들어가야 한다 (B=%, E=%)', v_b, v_e;
  end if;

  -- ---------------- 2) 동시 수정 ----------------
  select * into v_s1 from tests_race.results r where r.scenario = 'version' and r.session_no = 1;
  select * into v_s2 from tests_race.results r where r.scenario = 'version' and r.session_no = 2;

  if v_s1.sqlstate is not null then
    raise exception '동시성 실패: 먼저 저장한 세션이 실패했다 (SQLSTATE %)', v_s1.sqlstate;
  end if;
  if (v_s1.result ->> 'version')::integer <> 2 then
    raise exception '동시성 실패: 첫 저장 후 버전이 %다(기대 2)', v_s1.result ->> 'version';
  end if;
  if v_s2.sqlstate is distinct from 'GF409' then
    raise exception '동시성 실패: 나중 저장의 오류 코드가 %다(기대 GF409 CONFLICT)',
      coalesce(v_s2.sqlstate, '없음(성공)');
  end if;

  select m.version, m.title into v_version, v_title
    from public.memories m where m.id = v_memory;
  if v_version <> 2 then
    raise exception '동시성 실패: 최종 버전이 %다(기대 2). 두 저장이 모두 반영됐을 수 있다', v_version;
  end if;
  if v_title <> 'A가 먼저 저장' then
    raise exception '동시성 실패: 나중 저장이 조용히 덮어썼다 (제목=%)', v_title;
  end if;

  -- ---------------- 3) 중복 제출 ----------------
  select * into v_s1 from tests_race.results r where r.scenario = 'idempotency' and r.session_no = 1;
  select * into v_s2 from tests_race.results r where r.scenario = 'idempotency' and r.session_no = 2;

  if v_s1.sqlstate is not null or v_s2.sqlstate is not null then
    raise exception '동시성 실패: 중복 제출 세션이 실패했다 (s1=%, s2=%)',
      coalesce(v_s1.sqlstate, 'ok'), coalesce(v_s2.sqlstate, 'ok');
  end if;
  if v_s1.result ->> 'memoryId' is null then
    raise exception '동시성 실패: 세션1이 memoryId를 반환하지 않았다';
  end if;
  if v_s1.result ->> 'memoryId' <> v_s2.result ->> 'memoryId' then
    raise exception '동시성 실패: 같은 requestId인데 서로 다른 memoryId를 반환했다 (% vs %)',
      v_s1.result ->> 'memoryId', v_s2.result ->> 'memoryId';
  end if;

  select count(*) into v_dupes from public.memories m
   where m.space_id = v_space and m.title = '중복 제출 추억';
  if v_dupes <> 1 then
    raise exception '동시성 실패: 같은 requestId로 추억이 %건 생겼다(기대 1건)', v_dupes;
  end if;

  -- ---------------- 4) 서로 다른 공간 동시 수락 (D3) ----------------
  select * into v_s1 from tests_race.results r where r.scenario = 'crossspace' and r.session_no = 1;
  select * into v_s2 from tests_race.results r where r.scenario = 'crossspace' and r.session_no = 2;

  if v_s1.sqlstate is not null then
    raise exception '동시성 실패: 먼저 수락한 세션이 실패했다 (SQLSTATE %)', v_s1.sqlstate;
  end if;
  if v_s2.sqlstate is null then
    raise exception '동시성 실패: 같은 사용자가 두 공간에 모두 들어갔다';
  end if;
  if v_s2.sqlstate = '23505' then
    raise exception '동시성 실패: 원시 UNIQUE 위반(23505)이 그대로 새어 나왔다. GF409로 매핑돼야 한다';
  end if;
  if v_s2.sqlstate <> 'GF409' then
    raise exception '동시성 실패: 늦은 수락의 오류 코드가 %다(기대 GF409)', v_s2.sqlstate;
  end if;

  select count(*) into v_members from public.space_members m
   where m.user_id = '0c0c0c0c-0000-4000-8000-00000000000f';
  if v_members <> 1 then
    raise exception '동시성 실패: 한 계정이 공간 %개에 속한다(기대 1개)', v_members;
  end if;

  -- ---------------- 5) 첫 프로필 동시 생성 (D3) ----------------
  select * into v_s1 from tests_race.results r where r.scenario = 'profile' and r.session_no = 1;
  select * into v_s2 from tests_race.results r where r.scenario = 'profile' and r.session_no = 2;

  if v_s1.sqlstate is not null then
    raise exception '동시성 실패: 먼저 저장한 프로필 세션이 실패했다 (SQLSTATE %)', v_s1.sqlstate;
  end if;
  if v_s2.sqlstate is null then
    raise exception '동시성 실패: 프로필 첫 저장이 두 번 성공했다';
  end if;
  if v_s2.sqlstate = '23505' then
    raise exception '동시성 실패: 프로필 생성에서 원시 23505가 새어 나왔다. GF409로 매핑돼야 한다';
  end if;
  if v_s2.sqlstate <> 'GF409' then
    raise exception '동시성 실패: 늦은 프로필 저장의 오류 코드가 %다(기대 GF409)', v_s2.sqlstate;
  end if;

  select count(*) into v_rows from public.profiles p
   where p.id = '0c0c0c0c-0000-4000-8000-000000000013';
  if v_rows <> 1 then
    raise exception '동시성 실패: 프로필이 %건이다(기대 1건)', v_rows;
  end if;

  raise notice 'ok  동시 수락: 정원 2명 유지, 먼저 잠근 세션만 성공, 패자 코드 %', v_invite_loser;
  raise notice 'ok  동시 수정: 나중 저장 GF409, 조용한 덮어쓰기 없음';
  raise notice 'ok  중복 제출: 두 응답의 memoryId 동일, 추억 1건';
  raise notice 'ok  공간 교차 동시 수락: 늦은 쪽 GF409(23505 아님), 계정당 공간 1개';
  raise notice 'ok  프로필 동시 생성: 늦은 쪽 GF409(23505 아님), 프로필 1건';
end;
$do$;

\echo '90_verify.sql 통과'
