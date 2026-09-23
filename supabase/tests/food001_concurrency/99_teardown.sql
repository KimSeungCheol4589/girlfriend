-- FOOD-001 동시성 정리 — 00_setup.sql이 만든 고정 ID만 지운다.

\set ON_ERROR_STOP on

\set fa '0f00d001-0000-4000-8000-00000000000a'
\set fb '0f00d001-0000-4000-8000-00000000000b'
\set fspace '0f00d001-0000-4000-8000-0000000000f1'

begin;
delete from public.mutation_requests where user_id in (:'fa', :'fb');
-- 공간을 지우면 구성원·설정·맛집·후기가 함께 지워진다(ON DELETE CASCADE).
delete from public.spaces where id = :'fspace';
delete from public.profiles where id in (:'fa', :'fb');
delete from auth.users where id in (:'fa', :'fb');
drop schema if exists tests_food_race cascade;

do $check$
begin
  if exists (select 1 from public.restaurants where space_id = '0f00d001-0000-4000-8000-0000000000f1')
     or exists (select 1 from public.spaces where id = '0f00d001-0000-4000-8000-0000000000f1')
     or exists (select 1 from auth.users where id in ('0f00d001-0000-4000-8000-00000000000a',
                                                      '0f00d001-0000-4000-8000-00000000000b')) then
    raise exception 'FOOD-001 동시성 정리 후 잔여물이 있다' using errcode = 'TS001';
  end if;
end;
$check$;
commit;

\echo 'FOOD-001 동시성 픽스처 정리 완료'
