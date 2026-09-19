-- DB-001 / 3. 무결성 트리거
--
-- 목적
--   * 작성자·공간·생성 시각 불변(DESIGN 5.3).
--   * 버전은 서버가 1씩 증가시킨다. 임의 값 설정을 거부한다.
--   * 사진 개수·순서, 커버·사진의 파일 상태, 미래 날짜를 DB에서 다시 검사한다.
--   * RPC를 우회한 직접 DML이 (권한이 새더라도) 잘못된 상태를 만들지 못하게 한다.

begin;

-- ---------------------------------------------------------------------------
-- 3.1 공통 트리거 함수
-- ---------------------------------------------------------------------------
create or replace function app_private.tg_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- TG_ARGV에 나열한 열은 UPDATE로 바꿀 수 없다.
create or replace function app_private.tg_immutable_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_col text;
begin
  foreach v_col in array tg_argv loop
    if (v_old -> v_col) is distinct from (v_new -> v_col) then
      perform app_private.raise_error('VALIDATION_ERROR',
        json_build_object(v_col, 'immutable')::text);
    end if;
  end loop;
  return new;
end;
$$;

-- 버전은 서버가 정확히 1씩 올린다.
create or replace function app_private.tg_version_step()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) ->> 'version')::integer <> (to_jsonb(old) ->> 'version')::integer + 1 then
    perform app_private.raise_error('CONFLICT', '{"version":"must_increment_by_one"}');
  end if;
  return new;
end;
$$;

-- TG_ARGV[0] 날짜 열이 한국 기준 오늘을 넘지 못하게 한다.
create or replace function app_private.tg_no_future_date()
returns trigger
language plpgsql
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

-- ---------------------------------------------------------------------------
-- 3.2 profiles
-- ---------------------------------------------------------------------------
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function app_private.tg_touch_updated_at();

drop trigger if exists profiles_immutable on public.profiles;
create trigger profiles_immutable
  before update on public.profiles
  for each row execute function app_private.tg_immutable_columns('id', 'created_at');

drop trigger if exists profiles_version on public.profiles;
create trigger profiles_version
  before update on public.profiles
  for each row execute function app_private.tg_version_step();

-- ---------------------------------------------------------------------------
-- 3.3 spaces
-- ---------------------------------------------------------------------------
drop trigger if exists spaces_touch on public.spaces;
create trigger spaces_touch
  before update on public.spaces
  for each row execute function app_private.tg_touch_updated_at();

drop trigger if exists spaces_immutable on public.spaces;
create trigger spaces_immutable
  before update on public.spaces
  for each row execute function app_private.tg_immutable_columns('id', 'created_by', 'created_at');

drop trigger if exists spaces_version on public.spaces;
create trigger spaces_version
  before update on public.spaces
  for each row execute function app_private.tg_version_step();

drop trigger if exists spaces_start_date on public.spaces;
create trigger spaces_start_date
  before insert or update on public.spaces
  for each row execute function app_private.tg_no_future_date('relationship_start_date');

-- ---------------------------------------------------------------------------
-- 3.4 space_members — 정원 백스톱
-- ---------------------------------------------------------------------------
-- 실제 동시성 보장은 accept_invite/create_space가 spaces 행을 FOR UPDATE로 잠그는 것이다.
-- 이 제약 트리거는 잠금을 거치지 않은 경로(직접 DML, 잘못된 후속 함수)를 막는 이중 안전장치다.
-- 커밋되지 않은 다른 트랜잭션의 행은 볼 수 없으므로 잠금 없는 동시 삽입까지 막지는 못한다.
create or replace function app_private.tg_space_member_limit()
returns trigger
language plpgsql
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

drop trigger if exists space_members_limit on public.space_members;
create constraint trigger space_members_limit
  after insert on public.space_members
  deferrable initially deferred
  for each row execute function app_private.tg_space_member_limit();

drop trigger if exists space_members_immutable on public.space_members;
create trigger space_members_immutable
  before update on public.space_members
  for each row execute function app_private.tg_immutable_columns('space_id', 'user_id', 'joined_at');

-- ---------------------------------------------------------------------------
-- 3.5 assets — 상태 전이와 불변 열
-- ---------------------------------------------------------------------------
create or replace function app_private.tg_asset_state_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 허용 전이: pending -> ready, pending -> deleting, ready -> deleting, 동일 상태 유지.
  if old.state <> new.state then
    if not (
      (old.state = 'pending' and new.state in ('ready', 'deleting'))
      or (old.state = 'ready' and new.state = 'deleting')
    ) then
      perform app_private.raise_error('VALIDATION_ERROR', '{"state":"transition_not_allowed"}');
    end if;
  end if;

  -- deleting 상태의 파일은 어떤 기록에도 연결되어 있으면 안 된다.
  if new.state = 'deleting' then
    if exists (select 1 from public.memory_photos p where p.asset_id = new.id)
       or exists (select 1 from public.space_settings s where s.cover_asset_id = new.id) then
      perform app_private.raise_error('CONFLICT', '{"asset":"still_attached"}');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists assets_touch on public.assets;
create trigger assets_touch
  before update on public.assets
  for each row execute function app_private.tg_touch_updated_at();

drop trigger if exists assets_immutable on public.assets;
create trigger assets_immutable
  before update on public.assets
  for each row execute function app_private.tg_immutable_columns(
    'id', 'space_id', 'uploader_id', 'purpose', 'mime_type', 'created_at');

drop trigger if exists assets_state_guard on public.assets;
create trigger assets_state_guard
  before update on public.assets
  for each row execute function app_private.tg_asset_state_guard();

-- ---------------------------------------------------------------------------
-- 3.6 space_settings — 커버 파일 검사
-- ---------------------------------------------------------------------------
create or replace function app_private.tg_space_settings_cover_guard()
returns trigger
language plpgsql
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
  -- 공간 일치는 복합 FK가 이미 강제한다. 여기서는 목적과 상태를 확인한다.
  if v_asset.purpose <> 'cover' then
    perform app_private.raise_error('VALIDATION_ERROR', '{"coverAssetId":"purpose"}');
  end if;
  if v_asset.state <> 'ready' then
    perform app_private.raise_error('VALIDATION_ERROR', '{"coverAssetId":"not_ready"}');
  end if;
  return new;
end;
$$;

drop trigger if exists space_settings_touch on public.space_settings;
create trigger space_settings_touch
  before update on public.space_settings
  for each row execute function app_private.tg_touch_updated_at();

drop trigger if exists space_settings_immutable on public.space_settings;
create trigger space_settings_immutable
  before update on public.space_settings
  for each row execute function app_private.tg_immutable_columns('space_id', 'created_at');

drop trigger if exists space_settings_version on public.space_settings;
create trigger space_settings_version
  before update on public.space_settings
  for each row execute function app_private.tg_version_step();

drop trigger if exists space_settings_cover_guard on public.space_settings;
create trigger space_settings_cover_guard
  before insert or update on public.space_settings
  for each row execute function app_private.tg_space_settings_cover_guard();

-- ---------------------------------------------------------------------------
-- 3.7 memories
-- ---------------------------------------------------------------------------
drop trigger if exists memories_touch on public.memories;
create trigger memories_touch
  before update on public.memories
  for each row execute function app_private.tg_touch_updated_at();

drop trigger if exists memories_immutable on public.memories;
create trigger memories_immutable
  before update on public.memories
  for each row execute function app_private.tg_immutable_columns(
    'id', 'space_id', 'author_id', 'created_at');

drop trigger if exists memories_version on public.memories;
create trigger memories_version
  before update on public.memories
  for each row execute function app_private.tg_version_step();

drop trigger if exists memories_date on public.memories;
create trigger memories_date
  before insert or update on public.memories
  for each row execute function app_private.tg_no_future_date('memory_date');

-- ---------------------------------------------------------------------------
-- 3.8 memory_photos — 파일 상태·개수·순서
-- ---------------------------------------------------------------------------
create or replace function app_private.tg_memory_photo_asset_guard()
returns trigger
language plpgsql
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

-- 커밋 시점에 기록별 사진 수와 순서 연속성을 검사한다.
create or replace function app_private.tg_memory_photo_set_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_memory uuid;
  v_limit  integer := app_private.config_int('memory_photo_limit', 10);
  v_count  integer;
  v_max    integer;
  v_distinct integer;
begin
  -- DELETE에서는 NEW가 없으므로 TG_OP로 구분한다.
  if tg_op = 'DELETE' then
    v_memory := old.memory_id;
  else
    v_memory := new.memory_id;
  end if;

  -- 기록이 이미 삭제됐으면 검사할 집합이 없다.
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
  -- 순서는 0부터 빈칸 없이 이어져야 한다.
  if v_count > 0 and (v_max <> v_count - 1 or v_distinct <> v_count) then
    perform app_private.raise_error('VALIDATION_ERROR', '{"photoAssetIds":"order"}');
  end if;
  return null;
end;
$$;

drop trigger if exists memory_photos_asset_guard on public.memory_photos;
create trigger memory_photos_asset_guard
  before insert or update on public.memory_photos
  for each row execute function app_private.tg_memory_photo_asset_guard();

drop trigger if exists memory_photos_immutable on public.memory_photos;
create trigger memory_photos_immutable
  before update on public.memory_photos
  for each row execute function app_private.tg_immutable_columns(
    'id', 'memory_id', 'space_id', 'asset_id', 'created_at');

drop trigger if exists memory_photos_set_guard on public.memory_photos;
create constraint trigger memory_photos_set_guard
  after insert or update or delete on public.memory_photos
  deferrable initially deferred
  for each row execute function app_private.tg_memory_photo_set_guard();

-- ---------------------------------------------------------------------------
-- 3.9 restaurants / restaurant_reviews
-- ---------------------------------------------------------------------------
drop trigger if exists restaurants_touch on public.restaurants;
create trigger restaurants_touch
  before update on public.restaurants
  for each row execute function app_private.tg_touch_updated_at();

drop trigger if exists restaurants_immutable on public.restaurants;
create trigger restaurants_immutable
  before update on public.restaurants
  for each row execute function app_private.tg_immutable_columns(
    'id', 'space_id', 'created_by', 'created_at');

drop trigger if exists restaurants_version on public.restaurants;
create trigger restaurants_version
  before update on public.restaurants
  for each row execute function app_private.tg_version_step();

drop trigger if exists restaurants_visited_date on public.restaurants;
create trigger restaurants_visited_date
  before insert or update on public.restaurants
  for each row execute function app_private.tg_no_future_date('visited_date');

-- 후기는 방문 완료 상태에서만 존재할 수 있다.
create or replace function app_private.tg_review_requires_visited()
returns trigger
language plpgsql
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

drop trigger if exists restaurant_reviews_touch on public.restaurant_reviews;
create trigger restaurant_reviews_touch
  before update on public.restaurant_reviews
  for each row execute function app_private.tg_touch_updated_at();

drop trigger if exists restaurant_reviews_immutable on public.restaurant_reviews;
create trigger restaurant_reviews_immutable
  before update on public.restaurant_reviews
  for each row execute function app_private.tg_immutable_columns(
    'id', 'restaurant_id', 'space_id', 'user_id', 'created_at');

drop trigger if exists restaurant_reviews_version on public.restaurant_reviews;
create trigger restaurant_reviews_version
  before update on public.restaurant_reviews
  for each row execute function app_private.tg_version_step();

drop trigger if exists restaurant_reviews_visited on public.restaurant_reviews;
create trigger restaurant_reviews_visited
  before insert or update on public.restaurant_reviews
  for each row execute function app_private.tg_review_requires_visited();

commit;
