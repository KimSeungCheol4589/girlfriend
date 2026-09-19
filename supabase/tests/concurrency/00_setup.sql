-- DB-001 동시성 테스트 — 공통 픽스처 (커밋된다)
--
-- 동시성 검증은 서로 다른 세션이 같은 데이터를 봐야 하므로 롤백할 수 없다.
-- 여기서 만든 행은 99_teardown.sql이 ID를 지정해 정확히 지운다.
-- 모든 신원은 합성이며 이메일 도메인은 race.invalid를 쓴다.

\set ON_ERROR_STOP on

\set ra '0c0c0c0c-0000-4000-8000-00000000000a'
\set rb '0c0c0c0c-0000-4000-8000-00000000000b'
\set re '0c0c0c0c-0000-4000-8000-00000000000e'
\set rspace '0c0c0c0c-0000-4000-8000-0000000000f1'
\set rmemory '0c0c0c0c-0000-4000-8000-0000000000d1'

begin;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  (:'ra', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'race.a@race.invalid', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  (:'rb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'race.b@race.invalid', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  (:'re', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'race.e@race.invalid', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

insert into public.profiles (id, nickname) values
  (:'ra', '레이스A'), (:'rb', '레이스B'), (:'re', '레이스E');

insert into public.spaces (id, created_by, name) values (:'rspace', :'ra', '동시성 공간');
insert into public.space_members (space_id, user_id) values (:'rspace', :'ra');
insert into public.space_settings (space_id) values (:'rspace');

-- 같은 공간에 대해 서로 다른 사람에게 유효한 초대를 두 개 만든다.
-- (앱 흐름에서는 create_invite가 이전 초대를 폐기하지만, 여기서는 정원 경쟁만 본다.)
insert into public.space_invites (space_id, invited_by, token_hash, target_email, expires_at) values
  (:'rspace', :'ra', app_private.hash_token('race-token-b-0000000000000000000000000000000000'),
   'race.b@race.invalid', now() + interval '1 hour'),
  (:'rspace', :'ra', app_private.hash_token('race-token-e-0000000000000000000000000000000000'),
   'race.e@race.invalid', now() + interval '1 hour');

-- 버전 경쟁용 추억
insert into public.memories (id, space_id, author_id, title, memory_date)
values (:'rmemory', :'rspace', :'ra', '경쟁 대상 추억', current_date - 1);

commit;

\echo '동시성 픽스처 생성 완료'
