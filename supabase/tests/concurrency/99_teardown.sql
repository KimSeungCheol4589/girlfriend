-- 동시성 테스트 픽스처 정리
-- 이 테스트가 만든 ID만 지운다. 다른 데이터는 건드리지 않는다.
-- 실패한 실행 뒤에도 그대로 다시 실행할 수 있다.

\set ON_ERROR_STOP on
\set rspace '0c0c0c0c-0000-4000-8000-0000000000f1'

begin;

delete from public.restaurant_reviews rv where rv.space_id = :'rspace';
delete from public.restaurants r         where r.space_id  = :'rspace';
delete from public.memories m            where m.space_id  = :'rspace';  -- memory_photos는 연쇄 삭제
delete from public.space_invites i       where i.space_id  = :'rspace';
delete from public.space_settings s      where s.space_id  = :'rspace';
delete from public.assets a              where a.space_id  = :'rspace';
delete from public.space_members m       where m.space_id  = :'rspace';
delete from public.spaces s              where s.id        = :'rspace';

delete from public.mutation_requests r
 where r.user_id in (select u.id from auth.users u where u.email like '%@race.invalid');
delete from public.profiles p
 where p.id in (select u.id from auth.users u where u.email like '%@race.invalid');
delete from auth.users u where u.email like '%@race.invalid';
delete from app_private.bootstrap_creators b where b.email like '%@race.invalid';

commit;

\echo '동시성 픽스처 정리 완료'
