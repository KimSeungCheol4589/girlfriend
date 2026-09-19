-- DB-001 / 12. 실행에서 드러난 결함 수정 (전진 마이그레이션)
--
-- 이미 적용된 DB에 덧붙이는 수정이다. 테이블을 지우거나 다시 만들지 않는다.
--
-- 결함 1) SQLSTATE 2201B — invalid repetition count(s)
--   PostgreSQL 정규식은 `{m,n}`의 반복 횟수를 255까지만 허용한다.
--   `^https://[^[:space:]]{3,500}$`가 한도를 넘어 map_url이 NULL이 아닌 행을 만들 때마다 실패했다.
--   (10_schema_constraints, 50_mutations 실패 원인)
--   수정: 반복 횟수를 쓰지 않고 `+`로 바꾸고 길이는 char_length로 따로 제한한다.
--
-- 결함 2) 지연 제약 트리거가 커밋 시점에 "호출자 역할"로 실행된다
--   SECURITY DEFINER RPC가 반환된 뒤 COMMIT에서 트리거가 실행되므로 본문이 authenticated로 돌아간다.
--   tg_space_member_limit의 지역 변수 초기화(app_private.config_int)에서
--   'permission denied for schema app_private'가 발생해 accept_invite가 성공한 뒤 COMMIT이 실패했다.
--   (동시성 테스트에서 두 사용자가 모두 롤백된 원인)
--   수정: 모든 트리거 함수를 SECURITY DEFINER + 고정 search_path로 만든다.
--         트리거 함수 자체는 계속 app_private에 있고 클라이언트 역할에 EXECUTE를 주지 않는다.
--         트리거 실행 시에는 함수 EXECUTE 권한을 다시 검사하지 않으므로(생성 시점에만 검사)
--         비공개 헬퍼는 여전히 직접 호출할 수 없다.
--
--   부수 효과(의도한 것): 트리거가 소유자 권한으로 돌아가므로 정원·사진 집합 검사가
--   RLS에 걸러지지 않은 실제 전체 행을 센다. 호출자 역할로 실행되면 RLS 때문에
--   개수를 잘못 셀 수 있었다.

begin;

-- ---------------------------------------------------------------------------
-- 12.1 지도 링크 형식 제약 교체
-- ---------------------------------------------------------------------------
alter table public.restaurants drop constraint if exists restaurants_map_url_https;

alter table public.restaurants
  add constraint restaurants_map_url_https
  check (map_url is null or map_url ~ '^https://[^[:space:]]+$');

alter table public.restaurants drop constraint if exists restaurants_map_url_length;

alter table public.restaurants
  add constraint restaurants_map_url_length
  check (map_url is null or char_length(map_url) between 11 and 500);

-- ---------------------------------------------------------------------------
-- 12.2 트리거 함수 — 전부 SECURITY DEFINER + 고정 search_path
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE는 기존 트리거 연결을 유지한다. 트리거를 다시 만들 필요가 없다.

create or replace function app_private.tg_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app_private.tg_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_col text;
begin
  -- TG_ARGV는 마이그레이션이 고정한 값이다. 사용자 입력이 들어오지 않는다.
  foreach v_col in array tg_argv loop
    if (v_old -> v_col) is distinct from (v_new -> v_col) then
      perform app_private.raise_error('VALIDATION_ERROR',
        json_build_object(v_col, 'immutable')::text);
    end if;
  end loop;
  return new;
end;
$$;

create or replace function app_private.tg_version_step()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (to_jsonb(new) ->> 'version')::integer <> (to_jsonb(old) ->> 'version')::integer + 1 then
    perform app_private.raise_error('CONFLICT', '{"version":"must_increment_by_one"}');
  end if;
  return new;
end;
$$;

create or replace function app_private.tg_no_future_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value date := (to_jsonb(new) ->> tg_argv[0])::date;
begin
  if v_value is not null and v_value > app_private.kst_today() then
    perform app_private.raise_error('VALIDATION_ERROR',
      json_build_object(tg_argv[0], 'future_date')::text);
  end if;
  return new;
end;
$$;

-- 지연 제약 트리거 (커밋 시점 실행)
create or replace function app_private.tg_space_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := app_private.config_int('space_member_limit', 2);
  v_count integer;
begin
  select count(*) into v_count from public.space_members m where m.space_id = new.space_id;
  if v_count > v_limit then
    perform app_private.raise_error('SPACE_FULL', '{"space":"member_limit"}');
  end if;
  return null;
end;
$$;

create or replace function app_private.tg_asset_state_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state <> new.state then
    if not (
      (old.state = 'pending' and new.state in ('ready', 'deleting'))
      or (old.state = 'ready' and new.state = 'deleting')
    ) then
      perform app_private.raise_error('VALIDATION_ERROR', '{"state":"transition_not_allowed"}');
    end if;
  end if;

  if new.state = 'deleting' then
    if exists (select 1 from public.memory_photos p where p.asset_id = new.id)
       or exists (select 1 from public.space_settings s where s.cover_asset_id = new.id) then
      perform app_private.raise_error('CONFLICT', '{"asset":"still_attached"}');
    end if;
  end if;

  return new;
end;
$$;

create or replace function app_private.tg_space_settings_cover_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets%rowtype;
begin
  if new.cover_asset_id is null then
    return new;
  end if;
  select * into v_asset from public.assets a where a.id = new.cover_asset_id;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"coverAssetId":"missing"}');
  end if;
  if v_asset.purpose <> 'cover' then
    perform app_private.raise_error('VALIDATION_ERROR', '{"coverAssetId":"purpose"}');
  end if;
  if v_asset.state <> 'ready' then
    perform app_private.raise_error('VALIDATION_ERROR', '{"coverAssetId":"not_ready"}');
  end if;
  return new;
end;
$$;

create or replace function app_private.tg_memory_photo_asset_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets%rowtype;
begin
  select * into v_asset from public.assets a where a.id = new.asset_id;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"assetId":"missing"}');
  end if;
  if v_asset.purpose <> 'memory' then
    perform app_private.raise_error('VALIDATION_ERROR', '{"assetId":"purpose"}');
  end if;
  if v_asset.state <> 'ready' then
    perform app_private.raise_error('VALIDATION_ERROR', '{"assetId":"not_ready"}');
  end if;
  return new;
end;
$$;

-- 지연 제약 트리거 (커밋 시점 실행)
create or replace function app_private.tg_memory_photo_set_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_memory uuid;
  v_limit  integer := app_private.config_int('memory_photo_limit', 10);
  v_count  integer;
  v_max    integer;
  v_distinct integer;
begin
  if tg_op = 'DELETE' then
    v_memory := old.memory_id;
  else
    v_memory := new.memory_id;
  end if;

  if not exists (select 1 from public.memories m where m.id = v_memory) then
    return null;
  end if;

  select count(*), coalesce(max(p.sort_order), -1), count(distinct p.sort_order)
    into v_count, v_max, v_distinct
    from public.memory_photos p
   where p.memory_id = v_memory;

  if v_count > v_limit then
    perform app_private.raise_error('VALIDATION_ERROR', '{"photoAssetIds":"limit"}');
  end if;
  if v_count > 0 and (v_max <> v_count - 1 or v_distinct <> v_count) then
    perform app_private.raise_error('VALIDATION_ERROR', '{"photoAssetIds":"order"}');
  end if;
  return null;
end;
$$;

create or replace function app_private.tg_review_requires_visited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select r.status into v_status from public.restaurants r where r.id = new.restaurant_id;
  if v_status is distinct from 'visited' then
    perform app_private.raise_error('CONFLICT', '{"restaurant":"not_visited"}');
  end if;
  return new;
end;
$$;

-- 트리거 함수는 여전히 클라이언트 역할에 노출하지 않는다.
revoke all on function app_private.tg_touch_updated_at()            from public, anon, authenticated, service_role;
revoke all on function app_private.tg_immutable_columns()           from public, anon, authenticated, service_role;
revoke all on function app_private.tg_version_step()                from public, anon, authenticated, service_role;
revoke all on function app_private.tg_no_future_date()              from public, anon, authenticated, service_role;
revoke all on function app_private.tg_space_member_limit()          from public, anon, authenticated, service_role;
revoke all on function app_private.tg_asset_state_guard()           from public, anon, authenticated, service_role;
revoke all on function app_private.tg_space_settings_cover_guard()  from public, anon, authenticated, service_role;
revoke all on function app_private.tg_memory_photo_asset_guard()    from public, anon, authenticated, service_role;
revoke all on function app_private.tg_memory_photo_set_guard()      from public, anon, authenticated, service_role;
revoke all on function app_private.tg_review_requires_visited()     from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12.3 save_restaurant 재작성 (정규식 수정)
-- ---------------------------------------------------------------------------
create or replace function public.save_restaurant(
  p_restaurant_id    uuid,
  p_name             text,
  p_area             text,
  p_category         text,
  p_map_url          text,
  p_memo             text,
  p_expected_version integer,
  p_request_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid;
  v_space      uuid;
  v_req        record;
  v_restaurant public.restaurants%rowtype;
  v_name       text;
  v_area       text;
  v_category   text;
  v_memo       text;
  v_map_url    text;
  v_host       text;
  v_hosts      text[];
  v_result     jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'saveRestaurant',
    jsonb_build_object(
      'restaurantId', p_restaurant_id,
      'name', p_name, 'area', p_area, 'category', p_category,
      'mapUrl', p_map_url, 'memo', p_memo,
      'expectedVersion', p_expected_version));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  v_name     := btrim(coalesce(p_name, ''));
  v_area     := btrim(coalesce(p_area, ''));
  v_category := btrim(coalesce(p_category, ''));
  v_memo     := coalesce(p_memo, '');
  v_map_url  := nullif(btrim(coalesce(p_map_url, '')), '');

  if char_length(v_name) < 1 or char_length(v_name) > 100 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"name":"length"}');
  end if;
  if char_length(v_area) > 50 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"area":"length"}');
  end if;
  if char_length(v_category) > 50 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"category":"length"}');
  end if;
  if char_length(v_memo) > 2000 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"memo":"length"}');
  end if;

  -- 지도 링크: HTTPS + 길이 + 운영자가 등록한 호스트. 서버가 링크를 가져오지 않는다.
  -- 정규식에 반복 횟수를 쓰지 않는다(PostgreSQL 한도 255).
  if v_map_url is not null then
    if v_map_url !~ '^https://[^[:space:]]+$' then
      perform app_private.raise_error('VALIDATION_ERROR', '{"mapUrl":"https_required"}');
    end if;
    if char_length(v_map_url) < 11 or char_length(v_map_url) > 500 then
      perform app_private.raise_error('VALIDATION_ERROR', '{"mapUrl":"length"}');
    end if;
    v_hosts := app_private.config_text_array('allowed_map_hosts');
    v_host  := app_private.url_host(v_map_url);
    if v_host is null or not (v_host = any(v_hosts)) then
      perform app_private.raise_error('VALIDATION_ERROR', '{"mapUrl":"host_not_allowed"}');
    end if;
  end if;

  if p_restaurant_id is null then
    if coalesce(p_expected_version, 0) <> 0 then
      perform app_private.raise_error('VALIDATION_ERROR', '{"expectedVersion":"must_be_zero_on_create"}');
    end if;
    insert into public.restaurants (space_id, created_by, name, area, category, map_url, memo)
    values (v_space, v_user, v_name, v_area, v_category, v_map_url, v_memo)
    returning * into v_restaurant;
  else
    select * into v_restaurant
      from public.restaurants r
     where r.id = p_restaurant_id and r.space_id = v_space
       for update;
    if not found then
      perform app_private.raise_error('NOT_FOUND', '{"restaurantId":"missing"}');
    end if;
    if p_expected_version is null or v_restaurant.version <> p_expected_version then
      perform app_private.raise_error('CONFLICT', '{"expectedVersion":"stale"}');
    end if;

    update public.restaurants r
       set name     = v_name,
           area     = v_area,
           category = v_category,
           map_url  = v_map_url,
           memo     = v_memo,
           version  = r.version + 1
     where r.id = v_restaurant.id
    returning * into v_restaurant;
  end if;

  v_result := jsonb_build_object(
    'restaurantId', v_restaurant.id,
    'version', v_restaurant.version,
    'status', v_restaurant.status);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

revoke all on function public.save_restaurant(uuid, text, text, text, text, text, integer, uuid)
  from public, anon;
grant execute on function public.save_restaurant(uuid, text, text, text, text, text, integer, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 12.4 자체 점검
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  -- (1) public 테이블에 붙은 모든 트리거 함수는 SECURITY DEFINER + 고정 search_path여야 한다.
  --     특히 지연 제약 트리거는 커밋 시점에 호출자 역할로 실행되므로 필수다.
  select string_agg(distinct format('%s(%s.%s)', t.tgname, n.nspname, p.proname), ', ')
    into v_bad
    from pg_trigger t
    join pg_class c  on c.oid = t.tgrelid
    join pg_namespace cn on cn.oid = c.relnamespace
    join pg_proc p   on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where not t.tgisinternal
     and cn.nspname = 'public'
     and (not p.prosecdef
          or p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) as cfg(v) where cfg.v like 'search\_path=%'));
  if v_bad is not null then
    raise exception 'DB-001 점검 실패: 트리거 함수가 SECURITY DEFINER/고정 search_path가 아니다 (%)', v_bad;
  end if;

  -- (2) 우리 트리거 함수는 클라이언트 역할이 직접 실행할 수 없어야 한다.
  --     (Supabase 내부 스키마의 트리거는 이 작업 소관이 아니므로 app_private로 한정한다.)
  select string_agg(distinct p.proname, ', ')
    into v_bad
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where not t.tgisinternal
     and n.nspname = 'app_private'
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad is not null then
    raise exception 'DB-001 점검 실패: 트리거 함수가 노출됐다 (%)', v_bad;
  end if;

  -- (3) 255를 넘는 정규식 반복 횟수가 남아 있으면 안 된다(실행 시점에만 터지는 결함).
  select string_agg(distinct format('%s.%s', n.nspname, p.proname), ', ')
    into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app', 'app_private')
     and p.prosrc ~ '\{[0-9]+,([3-9][0-9]{2,}|[0-9]{4,})\}';
  if v_bad is not null then
    raise exception 'DB-001 점검 실패: 반복 횟수가 255를 넘는 정규식 (%)', v_bad;
  end if;

  select string_agg(distinct format('%s.%s', c.relname, con.conname), ', ')
    into v_bad
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ~ '\{[0-9]+,([3-9][0-9]{2,}|[0-9]{4,})\}';
  if v_bad is not null then
    raise exception 'DB-001 점검 실패: 제약의 정규식 반복 횟수가 255를 넘는다 (%)', v_bad;
  end if;
end;
$$;

commit;
