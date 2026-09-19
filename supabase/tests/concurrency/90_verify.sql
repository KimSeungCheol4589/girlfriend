-- 동시성 테스트 결과 검증 (postgres 세션에서 실행)
-- 세 경쟁 시나리오가 모두 끝난 뒤 실행한다. 위반이 있으면 오류로 종료한다.

\set ON_ERROR_STOP on
\set rspace '0c0c0c0c-0000-4000-8000-0000000000f1'
\set rb '0c0c0c0c-0000-4000-8000-00000000000b'
\set re '0c0c0c0c-0000-4000-8000-00000000000e'
\set rmemory '0c0c0c0c-0000-4000-8000-0000000000d1'

do $do$
declare
  v_members  integer;
  v_b        integer;
  v_e        integer;
  v_version  integer;
  v_title    text;
  v_dupes    integer;
begin
  select count(*) into v_members
    from public.space_members m where m.space_id = '0c0c0c0c-0000-4000-8000-0000000000f1';
  if v_members <> 2 then
    raise exception '동시성 실패: 구성원 수가 %명이다(기대 2명)', v_members;
  end if;

  select count(*) into v_b from public.space_members m
   where m.space_id = '0c0c0c0c-0000-4000-8000-0000000000f1'
     and m.user_id = '0c0c0c0c-0000-4000-8000-00000000000b';
  select count(*) into v_e from public.space_members m
   where m.space_id = '0c0c0c0c-0000-4000-8000-0000000000f1'
     and m.user_id = '0c0c0c0c-0000-4000-8000-00000000000e';
  if v_b <> 1 or v_e <> 0 then
    raise exception '동시성 실패: 먼저 잠근 세션(B)만 들어가야 한다 (B=%, E=%)', v_b, v_e;
  end if;

  select m.version, m.title into v_version, v_title
    from public.memories m where m.id = '0c0c0c0c-0000-4000-8000-0000000000d1';
  if v_version <> 2 then
    raise exception '동시성 실패: 버전이 %다(기대 2). 두 저장이 모두 반영됐을 수 있다', v_version;
  end if;
  if v_title <> 'A가 먼저 저장' then
    raise exception '동시성 실패: 나중 저장이 조용히 덮어썼다 (제목=%)', v_title;
  end if;

  select count(*) into v_dupes from public.memories m
   where m.space_id = '0c0c0c0c-0000-4000-8000-0000000000f1'
     and m.title = '중복 제출 추억';
  if v_dupes <> 1 then
    raise exception '동시성 실패: 같은 requestId로 추억이 %건 생겼다(기대 1건)', v_dupes;
  end if;

  raise notice 'ok  동시 수락: 정원 2명 유지, 먼저 잠근 세션만 성공';
  raise notice 'ok  동시 수정: 나중 저장은 CONFLICT, 조용한 덮어쓰기 없음';
  raise notice 'ok  중복 제출: 같은 requestId로 추억 1건만 생성';
end;
$do$;

\echo '90_verify.sql 통과'
