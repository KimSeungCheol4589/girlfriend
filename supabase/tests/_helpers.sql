-- DB-001 테스트 공통 헬퍼
--
-- 각 테스트 파일이 자신의 트랜잭션 안에서 \ir 로 읽어 들인다.
-- 트랜잭션을 ROLLBACK하면 이 스키마도 함께 사라지므로 DB에 잔여물이 남지 않는다.
--
-- 합성 신원만 사용한다. 이메일은 예약 TLD인 .invalid를 쓴다.
-- 실제 사용자·사진·자격 증명은 넣지 않는다.

create schema if not exists tests_support;
grant usage on schema tests_support to public;

-- ---------------------------------------------------------------------------
-- 단언
-- ---------------------------------------------------------------------------
create or replace function tests_support.ok(p_condition boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'TEST FAIL [%]', p_label using errcode = 'TS001';
  end if;
  raise notice 'ok  %', p_label;
end;
$$;

create or replace function tests_support.eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'TEST FAIL [%]: 실제 % / 기대 %', p_label, p_actual, p_expected
      using errcode = 'TS001';
  end if;
  raise notice 'ok  %', p_label;
end;
$$;

-- 지정한 SQL이 반드시 실패해야 하고, 원하면 SQLSTATE까지 일치해야 한다.
-- p_sqlstate가 NULL이면 "어떤 오류든 발생"만 확인한다.
create or replace function tests_support.expect_error(
  p_sql text, p_sqlstate text, p_label text)
returns void
language plpgsql
as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
    v_msg   := sqlerrm;
  end;

  if v_state is null then
    raise exception 'TEST FAIL [%]: 오류 없이 성공했다(기대 SQLSTATE %)', p_label, coalesce(p_sqlstate, 'any')
      using errcode = 'TS001';
  end if;
  if v_state = 'TS001' then
    raise exception 'TEST FAIL [%]: 내부 단언 실패 전파 — %', p_label, v_msg using errcode = 'TS001';
  end if;
  if p_sqlstate is not null and v_state <> p_sqlstate then
    raise exception 'TEST FAIL [%]: SQLSTATE % (%) / 기대 %', p_label, v_state, v_msg, p_sqlstate
      using errcode = 'TS001';
  end if;
  raise notice 'ok  % (거부 %)', p_label, v_state;
end;
$$;

-- 권한 거부(42501) 또는 RLS로 인한 0행 반환 중 하나임을 확인한다.
create or replace function tests_support.expect_no_rows(p_sql text, p_label text)
returns void
language plpgsql
as $$
declare
  v_count bigint;
begin
  begin
    execute format('select count(*) from (%s) as sub', p_sql) into v_count;
  exception when insufficient_privilege then
    raise notice 'ok  % (권한 거부)', p_label;
    return;
  end;
  if v_count <> 0 then
    raise exception 'TEST FAIL [%]: %행이 보였다(기대 0행)', p_label, v_count using errcode = 'TS001';
  end if;
  raise notice 'ok  % (0행)', p_label;
end;
$$;

-- ---------------------------------------------------------------------------
-- 역할 전환 사이에 값을 전달하기 위한 임시 저장소
-- (트랜잭션 롤백과 함께 사라진다)
-- ---------------------------------------------------------------------------
create table if not exists tests_support.state (key text primary key, value text);
grant all on table tests_support.state to public;

create or replace function tests_support.put(p_key text, p_value text)
returns text
language plpgsql
as $$
begin
  insert into tests_support.state (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
  return p_value;
end;
$$;

create or replace function tests_support.get(p_key text)
returns text
language sql
stable
as $$
  select s.value from tests_support.state s where s.key = p_key;
$$;

-- ---------------------------------------------------------------------------
-- 세션 컨텍스트
-- ---------------------------------------------------------------------------
create or replace function tests_support.claims(p_user uuid)
returns text
language sql
immutable
as $$
  select json_build_object('sub', p_user::text, 'role', 'authenticated', 'aud', 'authenticated')::text;
$$;

-- ---------------------------------------------------------------------------
-- 합성 픽스처
-- ---------------------------------------------------------------------------
create or replace function tests_support.make_user(
  p_id uuid, p_email text, p_confirmed boolean default true)
returns uuid
language plpgsql
as $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (
    p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, case when p_confirmed then now() else null end,
    now(), now(), '{}'::jsonb, '{}'::jsonb);
  return p_id;
end;
$$;

create or replace function tests_support.make_profile(p_id uuid, p_nickname text)
returns uuid
language plpgsql
as $$
begin
  insert into public.profiles (id, nickname) values (p_id, p_nickname)
  on conflict (id) do nothing;
  return p_id;
end;
$$;

-- 공간 + 구성원 + 기본 설정을 소유자 권한으로 직접 만든다.
-- RPC 흐름 자체는 40번 테스트에서 별도로 검증한다.
create or replace function tests_support.make_space(
  p_space uuid, p_owner uuid, p_name text)
returns uuid
language plpgsql
as $$
begin
  insert into public.spaces (id, created_by, name) values (p_space, p_owner, p_name);
  insert into public.space_members (space_id, user_id) values (p_space, p_owner);
  insert into public.space_settings (space_id) values (p_space);
  return p_space;
end;
$$;

create or replace function tests_support.add_member(p_space uuid, p_user uuid)
returns void
language plpgsql
as $$
begin
  insert into public.space_members (space_id, user_id) values (p_space, p_user);
end;
$$;

-- 준비된(ready) 파일을 직접 만든다.
create or replace function tests_support.make_asset(
  p_id uuid, p_space uuid, p_uploader uuid,
  p_purpose text default 'memory', p_state text default 'ready')
returns uuid
language plpgsql
as $$
begin
  insert into public.assets (
    id, space_id, uploader_id, purpose, mime_type, state,
    bytes, width, height, ready_at, expires_at)
  values (
    p_id, p_space, p_uploader, p_purpose, 'image/webp', p_state,
    case when p_state = 'ready' then 1024 end,
    case when p_state = 'ready' then 800 end,
    case when p_state = 'ready' then 600 end,
    case when p_state = 'ready' then now() end,
    now() + interval '24 hours');
  return p_id;
end;
$$;

create or replace function tests_support.make_memory(
  p_id uuid, p_space uuid, p_author uuid, p_title text default '테스트 추억')
returns uuid
language plpgsql
as $$
begin
  insert into public.memories (id, space_id, author_id, title, memory_date)
  values (p_id, p_space, p_author, p_title, current_date - 1);
  return p_id;
end;
$$;

create or replace function tests_support.make_restaurant(
  p_id uuid, p_space uuid, p_creator uuid,
  p_status text default 'wishlist')
returns uuid
language plpgsql
as $$
begin
  insert into public.restaurants (id, space_id, created_by, name, status, visited_date)
  values (p_id, p_space, p_creator, '테스트 식당', p_status,
          case when p_status = 'visited' then current_date - 1 end);
  return p_id;
end;
$$;
