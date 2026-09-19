-- DB-001 동시성 테스트 — 공통 픽스처와 결과 기록소 (커밋된다)
--
-- 동시성 검증은 서로 다른 세션이 같은 데이터를 봐야 하므로 롤백할 수 없다.
-- 99_teardown.sql이 **정확한 고정 UUID**만 지운다(이메일 도메인 일괄 삭제를 쓰지 않는다).
-- 모든 신원은 합성이다.
--
-- 각 세션은 자기 결과(SQLSTATE와 반환 JSON)를 tests_race.results에 남긴다.
-- 로그 문자열 대신 이 표를 근거로 90_verify.sql이 판정한다.

\set ON_ERROR_STOP on

\set ra '0c0c0c0c-0000-4000-8000-00000000000a'
\set rb '0c0c0c0c-0000-4000-8000-00000000000b'
\set re '0c0c0c0c-0000-4000-8000-00000000000e'
\set rf '0c0c0c0c-0000-4000-8000-00000000000f'
\set rg '0c0c0c0c-0000-4000-8000-000000000011'
\set rh '0c0c0c0c-0000-4000-8000-000000000012'
\set rp '0c0c0c0c-0000-4000-8000-000000000013'
\set rspace '0c0c0c0c-0000-4000-8000-0000000000f1'
\set rspacex '0c0c0c0c-0000-4000-8000-0000000000f2'
\set rspacey '0c0c0c0c-0000-4000-8000-0000000000f3'
\set rmemory '0c0c0c0c-0000-4000-8000-0000000000d1'

begin;

-- 결과 기록소. 세션이 authenticated 역할로 쓰므로 권한을 연다(테스트 전용 스키마).
drop schema if exists tests_race cascade;
create schema tests_race;
grant usage on schema tests_race to public;

create table tests_race.results (
  scenario    text not null,
  session_no  integer not null,
  sqlstate    text,
  detail      text,
  result      jsonb,
  recorded_at timestamptz not null default now(),
  primary key (scenario, session_no)
);
grant all on table tests_race.results to public;

-- 세션 2가 자기 backend pid를 **미리 커밋해서** 알린다.
-- 세션 1은 이 pid로 pg_blocking_pids를 확인해 "그 세션이 나 때문에 막혀 있는지"를 본다.
-- pg_stat_activity는 SET ROLE 이후 다른 세션의 열이 대부분 NULL이라 쓸 수 없다.
create table tests_race.sessions (
  scenario   text not null,
  session_no integer not null,
  pid        integer not null,
  primary key (scenario, session_no)
);
grant all on table tests_race.sessions to public;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  (:'ra', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'race.a@race.invalid', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  (:'rb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'race.b@race.invalid', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  (:'re', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'race.e@race.invalid', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  (:'rf', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'race.f@race.invalid', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  (:'rg', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'race.g@race.invalid', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  (:'rh', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'race.h@race.invalid', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  (:'rp', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'race.p@race.invalid', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

-- rp에는 프로필을 만들지 않는다. 첫 프로필 동시 생성 경쟁을 위해서다.
insert into public.profiles (id, nickname) values
  (:'ra', '레이스A'), (:'rb', '레이스B'), (:'re', '레이스E'),
  (:'rf', '레이스F'), (:'rg', '레이스G'), (:'rh', '레이스H');

insert into public.spaces (id, created_by, name) values (:'rspace', :'ra', '동시성 공간');
insert into public.space_members (space_id, user_id) values (:'rspace', :'ra');
insert into public.space_settings (space_id) values (:'rspace');

-- 같은 공간에 대해 서로 다른 사람에게 유효한 초대를 두 개 만든다.
-- (앱 흐름에서는 create_invite가 이전 초대를 폐기한다. 여기서는 정원 경쟁만 본다.)
insert into public.space_invites (space_id, invited_by, token_hash, target_email, expires_at) values
  (:'rspace', :'ra', app_private.hash_token('race-token-b-0000000000000000000000000000000000'),
   'race.b@race.invalid', now() + interval '1 hour'),
  (:'rspace', :'ra', app_private.hash_token('race-token-e-0000000000000000000000000000000000'),
   'race.e@race.invalid', now() + interval '1 hour');

-- 버전 경쟁용 추억
insert into public.memories (id, space_id, author_id, title, memory_date)
values (:'rmemory', :'rspace', :'ra', '경쟁 대상 추억', current_date - 1);

-- ---------------------------------------------------------------------------
-- 서로 다른 공간 동시 수락(D3)용: 공간 두 개와 같은 사람(F)에게 간 초대 두 개
-- ---------------------------------------------------------------------------
-- 두 세션이 **서로 다른 공간 행**을 잠그므로 공간 잠금으로는 직렬화되지 않는다.
-- 계정당 공간 하나 UNIQUE가 최종 방어이고, 그 위반이 계약 코드로 나와야 한다.
insert into public.spaces (id, created_by, name) values
  (:'rspacex', :'rg', '동시성 공간 X'),
  (:'rspacey', :'rh', '동시성 공간 Y');
insert into public.space_members (space_id, user_id) values
  (:'rspacex', :'rg'), (:'rspacey', :'rh');
insert into public.space_settings (space_id) values (:'rspacex'), (:'rspacey');

insert into public.space_invites (space_id, invited_by, token_hash, target_email, expires_at) values
  (:'rspacex', :'rg', app_private.hash_token('race-token-x-0000000000000000000000000000000000'),
   'race.f@race.invalid', now() + interval '1 hour'),
  (:'rspacey', :'rh', app_private.hash_token('race-token-y-0000000000000000000000000000000000'),
   'race.f@race.invalid', now() + interval '1 hour');

commit;

\echo '동시성 픽스처 생성 완료'
