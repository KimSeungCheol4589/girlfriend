-- 동시성 테스트 픽스처 정리
--
-- **고정 UUID만** 지운다. 이메일 도메인 같은 패턴으로 일괄 삭제하지 않는다
-- (다른 데이터를 함께 지울 위험을 없애기 위해서다).
-- 실패한 실행 뒤에도 그대로 다시 실행할 수 있다.

\set ON_ERROR_STOP on

begin;

-- 이 테스트가 만드는 공간·사용자 ID 목록. 여기 없는 것은 건드리지 않는다.
create temporary table if not exists race_fixture_spaces (id uuid primary key) on commit drop;
create temporary table if not exists race_fixture_users (id uuid primary key) on commit drop;

insert into race_fixture_spaces (id) values
  ('0c0c0c0c-0000-4000-8000-0000000000f1'),
  ('0c0c0c0c-0000-4000-8000-0000000000f2'),
  ('0c0c0c0c-0000-4000-8000-0000000000f3')
on conflict do nothing;

insert into race_fixture_users (id) values
  ('0c0c0c0c-0000-4000-8000-00000000000a'),
  ('0c0c0c0c-0000-4000-8000-00000000000b'),
  ('0c0c0c0c-0000-4000-8000-00000000000e'),
  ('0c0c0c0c-0000-4000-8000-00000000000f'),
  ('0c0c0c0c-0000-4000-8000-000000000011'),
  ('0c0c0c0c-0000-4000-8000-000000000012'),
  ('0c0c0c0c-0000-4000-8000-000000000013')
on conflict do nothing;

delete from public.restaurant_reviews rv where rv.space_id in (select s.id from race_fixture_spaces s);
delete from public.restaurants r         where r.space_id  in (select s.id from race_fixture_spaces s);
delete from public.memories m            where m.space_id  in (select s.id from race_fixture_spaces s);
delete from public.space_invites i       where i.space_id  in (select s.id from race_fixture_spaces s);
delete from public.space_settings s      where s.space_id  in (select f.id from race_fixture_spaces f);
delete from public.assets a              where a.space_id  in (select s.id from race_fixture_spaces s);
delete from public.space_members m       where m.space_id  in (select s.id from race_fixture_spaces s);
delete from public.spaces s              where s.id        in (select f.id from race_fixture_spaces f);

delete from public.mutation_requests r where r.user_id in (select u.id from race_fixture_users u);
delete from public.profiles p          where p.id      in (select u.id from race_fixture_users u);
delete from auth.users u               where u.id      in (select f.id from race_fixture_users f);

drop schema if exists tests_race cascade;

commit;

-- 남은 것이 없는지 확인한다.
do $do$
declare
  v_users  integer;
  v_spaces integer;
begin
  select count(*) into v_users from auth.users u
   where u.id in ('0c0c0c0c-0000-4000-8000-00000000000a',
                  '0c0c0c0c-0000-4000-8000-00000000000b',
                  '0c0c0c0c-0000-4000-8000-00000000000e',
                  '0c0c0c0c-0000-4000-8000-00000000000f',
                  '0c0c0c0c-0000-4000-8000-000000000011',
                  '0c0c0c0c-0000-4000-8000-000000000012',
                  '0c0c0c0c-0000-4000-8000-000000000013');
  select count(*) into v_spaces from public.spaces s
   where s.id in ('0c0c0c0c-0000-4000-8000-0000000000f1',
                  '0c0c0c0c-0000-4000-8000-0000000000f2',
                  '0c0c0c0c-0000-4000-8000-0000000000f3');
  if v_users <> 0 or v_spaces <> 0 then
    raise exception '정리 실패: 합성 계정 %건, 공간 %건이 남았다', v_users, v_spaces;
  end if;
end;
$do$;

\echo '동시성 픽스처 정리 완료'
