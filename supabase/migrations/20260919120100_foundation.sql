-- DB-001 / 1. 기반 스키마, 오류 코드, 순수 헬퍼, 운영 설정
--
-- 이 파일은 제품 테이블보다 먼저 적용한다.
-- 원칙
--   * 모든 함수는 고정 search_path('')를 쓰고 식별자를 스키마로 한정한다.
--   * 모든 함수의 PUBLIC EXECUTE 기본 권한을 제거한다.
--   * 외부 확장(pgcrypto 등)에 의존하지 않는다. sha256()·gen_random_uuid()는 pg_catalog 기본 제공이다.

begin;

create schema if not exists app;         -- RLS 정책과 조회에서 호출하는 읽기 전용 헬퍼
create schema if not exists app_private; -- 내부 전용. anon/authenticated에 노출하지 않는다.

revoke all on schema app from public;
revoke all on schema app_private from public;
grant usage on schema app to anon, authenticated, service_role;

-- 새로 만들어지는 객체에 자동 권한이 붙지 않게 한다.
--   * PostgreSQL 기본값: 함수 EXECUTE가 PUBLIC에 부여된다.
--   * Supabase 기본 이미지: public 스키마의 신규 테이블·함수에 anon/authenticated 권한이 부여된다.
-- 두 경로를 모두 차단하고, 필요한 권한만 뒤에서 명시적으로 부여한다.
alter default privileges in schema public      revoke execute on functions from public;
alter default privileges in schema app         revoke execute on functions from public;
alter default privileges in schema app_private revoke execute on functions from public;
alter default privileges in schema public      revoke execute on functions from anon, authenticated;
alter default privileges in schema app         revoke execute on functions from anon, authenticated;
alter default privileges in schema app_private revoke execute on functions from anon, authenticated;
alter default privileges in schema public      revoke all on tables    from anon, authenticated;
alter default privileges in schema public      revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1.1 오류 코드 매핑
-- ---------------------------------------------------------------------------
-- DESIGN 7절의 오류 코드를 사용자 정의 SQLSTATE('GF' 클래스)로 고정한다.
-- MESSAGE에는 코드 문자열만, DETAIL에는 필드 단위 힌트 JSON만 넣는다.
-- 사용자 입력 본문·이메일·토큰은 어떤 필드에도 넣지 않는다.
create or replace function app_private.raise_error(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_sqlstate text;
begin
  v_sqlstate := case p_code
    when 'UNAUTHENTICATED'  then 'GF401'
    when 'FORBIDDEN'        then 'GF403'
    when 'NOT_FOUND'        then 'GF404'
    when 'CONFLICT'         then 'GF409'
    when 'INVITE_INVALID'   then 'GF410'
    when 'SPACE_FULL'       then 'GF411'
    when 'UPLOAD_FAILED'    then 'GF412'
    when 'VALIDATION_ERROR' then 'GF422'
    when 'RETRYABLE_ERROR'  then 'GF503'
    else 'GF500'
  end;
  raise exception using
    errcode = v_sqlstate,
    message = p_code,
    detail  = coalesce(p_detail, '{}');
end;
$$;

comment on function app_private.raise_error(text, text) is
  'DESIGN 오류 코드를 GF 클래스 SQLSTATE로 변환해 예외를 발생시킨다. DETAIL은 필드 힌트 JSON만 담는다.';

-- ---------------------------------------------------------------------------
-- 1.2 순수(IMMUTABLE) 헬퍼 — CHECK 제약과 해시 계산에 사용
-- ---------------------------------------------------------------------------

create or replace function app_private.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

create or replace function app_private.is_valid_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_email is not null
     and char_length(p_email) between 3 and 254
     and p_email = lower(btrim(p_email))
     and p_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
$$;

-- 초대 상태 조회에서 대상 이메일을 그대로 노출하지 않기 위한 마스킹.
create or replace function app_private.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then null
    else left(split_part(p_email, '@', 1), 1)
         || repeat('*', greatest(char_length(split_part(p_email, '@', 1)) - 1, 1))
         || '@'
         || split_part(p_email, '@', 2)
  end;
$$;

create or replace function app_private.hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

comment on function app_private.hash_token(text) is
  '초대 토큰 원문은 저장하지 않는다. 이 함수의 SHA-256 hex 결과만 저장·비교한다.';

-- 중복 요청 판별용 페이로드 해시. jsonb는 키 정렬·중복 제거가 되어 있어 값이 같으면 텍스트도 같다.
create or replace function app_private.payload_hash(p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8')), 'hex');
$$;

create or replace function app_private.is_valid_tags(p_tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tags is not null
     and coalesce(array_ndims(p_tags), 1) = 1
     and coalesce(array_length(p_tags, 1), 0) <= 5
     and not exists (
           select 1 from unnest(p_tags) as t(v)
            where t.v is null
               or t.v <> btrim(t.v)
               or char_length(t.v) < 1
               or char_length(t.v) > 20
         )
     and (select count(distinct t.v) from unnest(p_tags) as t(v))
         = coalesce(array_length(p_tags, 1), 0);
$$;

-- 홈 섹션 JSON: 지정한 3개 키가 정확히 한 번씩, key/visible 두 필드만 허용한다.
create or replace function app_private.is_valid_home_sections(p_sections jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_sections) = 'array'
     and jsonb_array_length(p_sections) = 3
     and (
       select count(*) = 3
         from jsonb_array_elements(p_sections) as e(v)
        where jsonb_typeof(e.v) = 'object'
          and (select count(*) from jsonb_object_keys(e.v) as k(name)) = 2
          and e.v ? 'key'
          and e.v ? 'visible'
          and jsonb_typeof(e.v -> 'visible') = 'boolean'
          and e.v ->> 'key' in ('pinned', 'recentMemories', 'wishlist')
     )
     and (
       select count(distinct e.v ->> 'key') = 3
         from jsonb_array_elements(p_sections) as e(v)
     );
$$;

create or replace function app_private.default_home_sections()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '[{"key":"pinned","visible":true},
           {"key":"recentMemories","visible":true},
           {"key":"wishlist","visible":true}]'::jsonb;
$$;

-- 한국 달력 기준 오늘. 미래 날짜 거부에 사용한다(DESIGN 9절).
create or replace function app_private.kst_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Seoul')::date;
$$;

create or replace function app_private.url_host(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(split_part(split_part(split_part(regexp_replace(coalesce(p_url, ''), '^https://', ''), '/', 1), '?', 1), '#', 1)), '');
$$;

-- ---------------------------------------------------------------------------
-- 1.3 운영 설정 — 클라이언트가 값을 주장할 수 없는 서버 전용 설정
-- ---------------------------------------------------------------------------

create table if not exists app_private.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into app_private.app_config (key, value) values
  ('space_member_limit',   '2'::jsonb),
  ('invite_ttl_hours',     '24'::jsonb),
  ('asset_ttl_hours',      '24'::jsonb),
  ('memory_photo_limit',   '10'::jsonb),
  ('upload_max_bytes',     '10485760'::jsonb),
  ('upload_max_pixels',    '40000000'::jsonb),
  ('allowed_map_hosts',    '["map.naver.com","m.map.naver.com","naver.me","map.kakao.com","place.map.kakao.com","kko.to"]'::jsonb)
on conflict (key) do nothing;

create or replace function app_private.config_int(p_key text, p_default integer)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce((select (c.value #>> '{}')::integer from app_private.app_config c where c.key = p_key), p_default);
$$;

create or replace function app_private.config_bigint(p_key text, p_default bigint)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce((select (c.value #>> '{}')::bigint from app_private.app_config c where c.key = p_key), p_default);
$$;

create or replace function app_private.config_text_array(p_key text)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select array_agg(v.item) from app_private.app_config c,
            lateral jsonb_array_elements_text(c.value) as v(item)
      where c.key = p_key),
    '{}'::text[]);
$$;

-- ---------------------------------------------------------------------------
-- 1.4 최초 공간 생성 허용 목록 — 운영자 전용, 기본은 전면 거부
-- ---------------------------------------------------------------------------
-- 클라이언트는 이 목록에 대해 어떤 값도 주장할 수 없다.
-- create_space는 auth.users의 확인된 이메일만 이 표와 대조한다.
-- 표가 비어 있으면 누구도 공간을 만들 수 없다(deny closed).
create table if not exists app_private.bootstrap_creators (
  email      text primary key,
  note       text not null default '',
  created_at timestamptz not null default now(),
  constraint bootstrap_creators_email_valid check (app_private.is_valid_email(email))
);

create or replace function app_private.is_bootstrap_creator(p_email text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_email is not null
     and exists (select 1 from app_private.bootstrap_creators b where b.email = p_email);
$$;

-- 운영자(service_role 또는 postgres)만 호출한다.
create or replace function app_private.add_bootstrap_creator(p_email text, p_note text default '')
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_email text := app_private.normalize_email(p_email);
begin
  if not app_private.is_valid_email(v_email) then
    perform app_private.raise_error('VALIDATION_ERROR', '{"email":"format"}');
  end if;
  insert into app_private.bootstrap_creators (email, note)
  values (v_email, coalesce(p_note, ''))
  on conflict (email) do update set note = excluded.note;
  return v_email;
end;
$$;

create or replace function app_private.remove_bootstrap_creator(p_email text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from app_private.bootstrap_creators b
   where b.email = app_private.normalize_email(p_email);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.5 권한 정리 — 이 파일에서 만든 객체
-- ---------------------------------------------------------------------------
revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
revoke all on all functions in schema app from public;

grant usage on schema app_private to service_role;
grant execute on function app_private.add_bootstrap_creator(text, text)  to service_role;
grant execute on function app_private.remove_bootstrap_creator(text)     to service_role;

commit;
